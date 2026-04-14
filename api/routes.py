"""
API routes for PDF Catalog Generator
"""
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from typing import List
import io
import httpx

from core.models import Category, Product, PDFConfig
from core.pdf_generator import PDFGenerator, estimate_pdf_pages, validate_image_url
from api.proxy import backend_proxy

router = APIRouter(prefix="/api")


@router.get("/categories", response_model=List[Category])
async def get_categories():
    """Get all categories"""
    try:
        return await backend_proxy.get_categories()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching categories: {str(e)}")


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
async def generate_pdf(config: PDFConfig):
    """Generate PDF with given configuration"""
    try:
        # Get category name
        categories = await backend_proxy.get_categories()
        category = next(
            (c for c in categories if c.category_id == config.category_id or c.id == config.category_id),
            None
        )

        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

        # Get all products and filter
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.get(
                    f"{backend_proxy.base_url}/products/preview",
                    params={"all": "true"}
                )
                response.raise_for_status()
                data = response.json()
                all_products = data.get("productos", [])
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="No se puede conectar al servidor de productos. Verifica tu conexión a internet."
                )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Tiempo de espera agotado. Intenta de nuevo."
                )

        # Filter by category and create product map
        product_map = {p["id"]: p for p in all_products if p.get("categoryId") == category.id}

        # Sort products by position
        ordered_products = []
        for prod_order in config.products:
            if prod_order.id in product_map:
                ordered_products.append(product_map[prod_order.id])

        if not ordered_products:
            # Use all products for category if no order specified
            ordered_products = list(product_map.values())

        if not ordered_products:
            raise HTTPException(status_code=404, detail="No products found for this category")

        # Check product count
        if len(ordered_products) > 100:
            raise HTTPException(
                status_code=400,
                detail=f"Too many products ({len(ordered_products)}). Maximum is 100."
            )

        # Generate PDF
        generator = PDFGenerator(config, ordered_products, category.title)
        pdf_bytes = generator.generate()

        # Check PDF size
        pdf_size_mb = len(pdf_bytes) / (1024 * 1024)
        if pdf_size_mb > 50:
            raise HTTPException(
                status_code=400,
                detail=f"PDF too large ({pdf_size_mb:.1f}MB). Maximum is 50MB."
            )

        # Return PDF
        filename = f"catalogo_{category.title.lower().replace(' ', '_')}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR generating PDF: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error generating PDF: {str(e)}")
