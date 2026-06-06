"""
API routes for PDF Catalog Generator
"""
from fastapi import APIRouter, HTTPException, Response, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from typing import List, Optional
import io
import json
import logging
import os
import time
import httpx

from core.models import Category, Product, PDFConfig, ProductOrder, ImagesConfig
from core.pdf_generator import PDFGenerator, estimate_pdf_pages, validate_image_url
from api.proxy import backend_proxy

logger = logging.getLogger("pdf_maker.routes")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)

router = APIRouter(prefix="/api")

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

PDF_TYPES = {"cover": "cover.pdf", "background": "background.pdf", "back_cover": "back_cover.pdf"}


@router.post("/save-pdf")
async def save_pdf(type: str = Form(...), file: UploadFile = File(...)):
    """Save a PDF file (cover/background/back_cover) on the server."""
    if type not in PDF_TYPES:
        raise HTTPException(status_code=400, detail="Invalid type. Use: cover, background, back_cover")
    path = os.path.join(UPLOADS_DIR, PDF_TYPES[type])
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    return {"ok": True, "type": type, "size": len(content)}


@router.get("/saved-pdfs")
async def get_saved_pdfs():
    """Return info about which PDFs are saved on the server."""
    result = {}
    for key, filename in PDF_TYPES.items():
        path = os.path.join(UPLOADS_DIR, filename)
        if os.path.exists(path):
            result[key] = {"exists": True, "size": os.path.getsize(path)}
        else:
            result[key] = {"exists": False}
    return result


@router.get("/pdf-file/{type}")
async def get_pdf_file(type: str):
    """Serve a saved PDF file for preview."""
    if type not in PDF_TYPES:
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(UPLOADS_DIR, PDF_TYPES[type])
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="application/pdf")


@router.get("/categories", response_model=List[Category])
async def get_categories():
    """Get all categories"""
    try:
        return await backend_proxy.get_categories()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching categories: {str(e)}")


@router.get("/colecciones")
async def get_colecciones():
    """Get all collections"""
    try:
        return await backend_proxy.get_colecciones()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching collections: {str(e)}")


@router.post("/colecciones/productos")
async def get_coleccion_productos(data: dict):
    """Get products by collection tag"""
    title = data.get("title")
    if not title:
        raise HTTPException(status_code=400, detail="El campo 'title' es requerido")
    try:
        result = await backend_proxy.get_products_by_coleccion(title)
        return {
            "products": result["productos"],
            "total": result["total"],
            "hasProducts": result["total"] > 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching collection products: {str(e)}")


@router.get("/products/{category_id}")
async def get_products(category_id: str):
    """Get products for a specific category"""
    try:
        print(f"DEBUG: Fetching products for category_id: {category_id}")

        # First, get the category to find the internal ID
        categories = await backend_proxy.get_categories()
        category = next(
            (c for c in categories if c.category_id == category_id or c.id == category_id),
            None
        )

        if not category:
            print(f"DEBUG: Category not found: {category_id}")
            raise HTTPException(status_code=404, detail="Category not found")

        print(f"DEBUG: Found category: {category.title}, internal ID: {category.id}")

        # Get ALL products using /products/preview?all=true
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                f"{backend_proxy.base_url}/products/preview",
                params={"all": "true"}
            )
            response.raise_for_status()
            data = response.json()

            all_products = data.get("productos", [])

            print(f"DEBUG: Total products from preview: {len(all_products)}")

            # Filter by category internal ID
            filtered_products = [p for p in all_products if p.get("categoryId") == category.id]

            print(f"DEBUG: Filtered products for category {category.title}: {len(filtered_products)}")

            return {
                "products": filtered_products,
                "total": len(filtered_products),
                "hasProducts": len(filtered_products) > 0
            }

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR fetching products for category {category_id}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error fetching products: {str(e)}")


@router.post("/validate-images")
async def validate_images(data: dict):
    """Validate image URLs before PDF generation"""
    urls = data.get("urls", {})
    results = {}

    for name, url in urls.items():
        if url:
            is_valid = validate_image_url(url)
            results[name] = {
                "valid": is_valid,
                "url": url
            }
        else:
            results[name] = {
                "valid": False,
                "url": url,
                "error": "URL vacía"
            }

    # All valid if at least one image is valid (more lenient)
    all_valid = any(r["valid"] for r in results.values())

    return {
        "results": results,
        "allValid": all_valid,
        "message": "Todas las imágenes son válidas" if all_valid else "Algunas imágenes no son válidas, pero puedes continuar"
    }


@router.post("/estimate-pages")
async def estimate_pages(data: dict):
    """Estimate PDF pages for given configuration"""
    product_count = data.get("productCount", 0)
    products_per_page = data.get("productsPerPage", 4)

    return {
        "estimatedPages": estimate_pdf_pages(product_count, products_per_page)
    }


@router.post("/generate-pdf")
async def generate_pdf(
    categoryId: str = Form(""),
    productsPerPage: int = Form(4),
    products: str = Form("[]"),
    categoryTitle: str = Form(""),
    productsData: str = Form(""),
    showDozenPrice: str = Form("false"),
    cover_pdf: Optional[UploadFile] = File(None),
    back_cover_pdf: Optional[UploadFile] = File(None),
    background_pdf: Optional[UploadFile] = File(None),
):
    """Generate PDF with given configuration, optionally merging cover/back cover PDFs"""
    t0 = time.time()
    logger.info("====== NUEVA PETICION /generate-pdf ======")
    logger.info("categoryId=%s | productsPerPage=%s | categoryTitle=%s | showDozenPrice=%s",
                categoryId, productsPerPage, categoryTitle, showDozenPrice)
    try:
        # Parse products order from JSON string
        try:
            products_list = json.loads(products)
            logger.info("Products order parseado: %d items", len(products_list))
        except json.JSONDecodeError:
            products_list = []
            logger.warning("No se pudo parsear products order, usando lista vacia")

        # Build config
        product_orders = [ProductOrder(**p) for p in products_list]
        config = PDFConfig(
            categoryId=categoryId or "coleccion",
            productsPerPage=productsPerPage,
            images=ImagesConfig(coverUrl="", backgroundUrl="", backCoverUrl=""),
            products=product_orders
        )
        logger.info("Config creado | categoryId=%s | %d products en orden", config.category_id, len(product_orders))

        # Determine products source: collection (productsData) or category
        if productsData:
            # Products sent directly from frontend (collection flow)
            logger.info("Flujo COLECCION (productsData provisto)")
            try:
                ordered_products = json.loads(productsData)
                logger.info("productsData parseado: %d productos", len(ordered_products))
            except json.JSONDecodeError:
                ordered_products = []
                logger.warning("No se pudo parsear productsData, lista vacia")
            display_title = categoryTitle.strip() if categoryTitle.strip() else "Colección"
        else:
            # Category flow: fetch from backend
            logger.info("Flujo CATEGORIA - obteniendo categorias del backend...")
            t1 = time.time()
            categories = await backend_proxy.get_categories()
            logger.info("Categorias obtenidas en %.2fs (%d categorias)", time.time() - t1, len(categories))

            category = next(
                (c for c in categories if c.category_id == config.category_id or c.id == config.category_id),
                None
            )

            if not category:
                logger.error("Categoria no encontrada: %s", config.category_id)
                raise HTTPException(status_code=404, detail="Category not found")

            logger.info("Categoria encontrada: %s (id=%s)", category.title, category.id)

            logger.info("Descargando productos del backend...")
            t2 = time.time()
            async with httpx.AsyncClient(timeout=60.0) as client:
                try:
                    response = await client.get(
                        f"{backend_proxy.base_url}/products/preview",
                        params={"all": "true"}
                    )
                    response.raise_for_status()
                    data = response.json()
                    all_products = data.get("productos", [])
                    logger.info("Productos del backend en %.2fs: %d total", time.time() - t2, len(all_products))
                except httpx.ConnectError as e:
                    logger.error("ConnectError al conectar al backend: %s", e)
                    raise HTTPException(
                        status_code=503,
                        detail="No se puede conectar al servidor de productos. Verifica tu conexión a internet."
                    )
                except httpx.TimeoutException as e:
                    logger.error("Timeout al conectar al backend: %s", e)
                    raise HTTPException(
                        status_code=504,
                        detail="Tiempo de espera agotado. Intenta de nuevo."
                    )

            product_map = {p["id"]: p for p in all_products if p.get("categoryId") == category.id}
            logger.info("Filtrados %d productos para categoria %s", len(product_map), category.title)

            ordered_products = []
            for prod_order in config.products:
                if prod_order.id in product_map:
                    ordered_products.append(product_map[prod_order.id])

            if not ordered_products:
                ordered_products = list(product_map.values())
                logger.info("Sin orden explicito, usando todos los productos de la categoria")

            display_title = categoryTitle.strip() if categoryTitle.strip() else category.title

        if not ordered_products:
            logger.error("No se encontraron productos")
            raise HTTPException(status_code=404, detail="No products found")

        logger.info("Productos finales: %d | Titulo: %s", len(ordered_products), display_title)

        # Check product count
        if len(ordered_products) > 300:
            logger.error("Demasiados productos: %d (max 300)", len(ordered_products))
            raise HTTPException(
                status_code=400,
                detail=f"Too many products ({len(ordered_products)}). Maximum is 300."
            )

        # Read uploaded PDFs (fallback to saved files)
        logger.info("Leyendo PDFs subidos...")
        t3 = time.time()
        cover_pdf_bytes = await cover_pdf.read() if cover_pdf else None
        back_cover_pdf_bytes = await back_cover_pdf.read() if back_cover_pdf else None
        background_pdf_bytes = await background_pdf.read() if background_pdf else None
        logger.info("PDFs subidos leidos en %.2fs | cover=%s | back=%s | bg=%s",
                     time.time() - t3,
                     f"{len(cover_pdf_bytes)}b" if cover_pdf_bytes else "None",
                     f"{len(back_cover_pdf_bytes)}b" if back_cover_pdf_bytes else "None",
                     f"{len(background_pdf_bytes)}b" if background_pdf_bytes else "None")

        # If not uploaded, try reading saved files
        if not cover_pdf_bytes:
            path = os.path.join(UPLOADS_DIR, PDF_TYPES["cover"])
            if os.path.exists(path):
                with open(path, "rb") as f:
                    cover_pdf_bytes = f.read()
                logger.info("Cover cargado desde disco: %s (%d bytes)", path, len(cover_pdf_bytes))
        if not back_cover_pdf_bytes:
            path = os.path.join(UPLOADS_DIR, PDF_TYPES["back_cover"])
            if os.path.exists(path):
                with open(path, "rb") as f:
                    back_cover_pdf_bytes = f.read()
                logger.info("Back cover cargado desde disco: %s (%d bytes)", path, len(back_cover_pdf_bytes))
        if not background_pdf_bytes:
            path = os.path.join(UPLOADS_DIR, PDF_TYPES["background"])
            if os.path.exists(path):
                with open(path, "rb") as f:
                    background_pdf_bytes = f.read()
                logger.info("Background cargado desde disco: %s (%d bytes)", path, len(background_pdf_bytes))

        # Generate PDF (use custom title if provided)
        logger.info("Iniciando generacion de PDF con PDFGenerator...")
        t4 = time.time()
        generator = PDFGenerator(config, ordered_products, display_title,
                                show_dozen_price=showDozenPrice.lower() == 'true')
        pdf_bytes = await generator.generate(
            cover_pdf_bytes=cover_pdf_bytes,
            back_cover_pdf_bytes=back_cover_pdf_bytes,
            background_pdf_bytes=background_pdf_bytes
        )
        logger.info("PDF generado en %.2fs (%d bytes / %.2f MB)", time.time() - t4, len(pdf_bytes), len(pdf_bytes) / (1024 * 1024))

        # Check PDF size
        pdf_size_mb = len(pdf_bytes) / (1024 * 1024)
        if pdf_size_mb > 50:
            logger.error("PDF demasiado grande: %.1fMB (max 50MB)", pdf_size_mb)
            raise HTTPException(
                status_code=400,
                detail=f"PDF too large ({pdf_size_mb:.1f}MB). Maximum is 50MB."
            )

        # Return PDF
        filename = f"catalogo_{display_title.lower().replace(' ', '_')}.pdf"
        logger.info("Enviando PDF: %s | Tiempo total: %.2fs", filename, time.time() - t0)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ERROR generando PDF (tiempo total: %.2fs): %s", time.time() - t0, e)
        raise HTTPException(status_code=500, detail=f"Error generating PDF: {str(e)}")
