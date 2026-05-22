"""
PDF Generator using Playwright + Jinja2
Creates modern A4 PDF catalogs with HTML/CSS templates
"""
import os
import re
import base64
import asyncio
from concurrent.futures import ProcessPoolExecutor
from io import BytesIO
from typing import List, Optional, Dict
import requests

try:
    import playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    HAS_JINJA2 = True
except ImportError:
    HAS_JINJA2 = False

try:
    from PyPDF2 import PdfReader, PdfWriter
    HAS_PYPDF2 = True
except ImportError:
    HAS_PYPDF2 = False

try:
    from PIL import Image, ImageFilter
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

from .models import PDFConfig


def _render_pdf_process(html_content: str) -> bytes:
    """Standalone function for ProcessPoolExecutor — must be at module level."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(html_content, wait_until="networkidle", timeout=60000)
        pdf_bytes = page.pdf(
            format='A4',
            margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'},
            print_background=True,
        )
        browser.close()
        return pdf_bytes


class PDFGenerator:
    """Generates A4 PDF catalogs using Playwright + Jinja2 templates"""

    def __init__(self, config: PDFConfig, products: List, category_name: str,
                 template_dir: str = None, show_dozen_price: bool = False):
        self.config = config
        self.products = products
        self.category_name = category_name
        self.show_dozen_price = show_dozen_price

        if template_dir is None:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            template_dir = os.path.join(os.path.dirname(current_dir), 'templates')

        self.template_dir = template_dir

        if HAS_JINJA2:
            self.env = Environment(
                loader=FileSystemLoader(template_dir),
                autoescape=select_autoescape(['html', 'xml'])
            )
            self.env.filters['batch'] = self._batch_filter
        else:
            self.env = None

    async def generate(self, cover_pdf_bytes: Optional[bytes] = None, back_cover_pdf_bytes: Optional[bytes] = None, background_pdf_bytes: Optional[bytes] = None) -> bytes:
        """Generate PDF and return as bytes. Optionally merge with cover/back cover PDFs and apply background PDF."""
        if not HAS_PLAYWRIGHT:
            raise ImportError("playwright is not installed. Install it with: pip install playwright && playwright install chromium")

        if not HAS_JINJA2:
            raise ImportError("Jinja2 is not installed. Install it with: pip install jinja2")

        # Prepare product data (parallel image downloads)
        products_data = await self._prepare_products_data()

        background_url = self.config.images.background_url if self.config.images else None
        skip_cover = cover_pdf_bytes is not None
        skip_back_cover = back_cover_pdf_bytes is not None
        use_bg_pdf = background_pdf_bytes is not None
        effective_bg_url = None if use_bg_pdf else background_url

        template = self.env.get_template('catalog.html')
        html_content = template.render(
            products=products_data,
            category_name=self.category_name,
            cover_url=None,
            background_url=effective_bg_url,
            back_cover_url=None,
            skip_cover=skip_cover,
            skip_back_cover=skip_back_cover,
            use_bg_pdf=use_bg_pdf,
            show_dozen_price=self.show_dozen_price
        )

        # Run Playwright in a separate process to avoid Windows asyncio event loop conflicts
        loop = asyncio.get_event_loop()
        with ProcessPoolExecutor(max_workers=1) as pool:
            catalog_bytes = await loop.run_in_executor(pool, _render_pdf_process, html_content)

        if background_pdf_bytes:
            background_pdf_bytes = self._normalize_pdf(background_pdf_bytes)
        if cover_pdf_bytes:
            cover_pdf_bytes = self._normalize_pdf(cover_pdf_bytes)
        if back_cover_pdf_bytes:
            back_cover_pdf_bytes = self._normalize_pdf(back_cover_pdf_bytes)

        if background_pdf_bytes:
            catalog_bytes = self._merge_background_pdf(catalog_bytes, background_pdf_bytes)

        if not cover_pdf_bytes and not back_cover_pdf_bytes:
            return catalog_bytes

        if not HAS_PYPDF2:
            raise ImportError("PyPDF2 is not installed. Install it with: pip install PyPDF2")

        writer = PdfWriter()

        if cover_pdf_bytes:
            for page in PdfReader(BytesIO(cover_pdf_bytes)).pages:
                writer.add_page(page)

        for page in PdfReader(BytesIO(catalog_bytes)).pages:
            writer.add_page(page)

        if back_cover_pdf_bytes:
            for page in PdfReader(BytesIO(back_cover_pdf_bytes)).pages:
                writer.add_page(page)

        output = BytesIO()
        writer.write(output)
        return output.getvalue()

    @staticmethod
    def _scale_to_a4(page) -> 'PageObject':
        """Scale a PDF page to fill A4 (210x297mm = 595.28x841.89 pts) with no gaps."""
        from PyPDF2 import PageObject as _PO, Transformation
        A4_W, A4_H = 595.28, 841.89
        src_w = float(page.mediabox.width)
        src_h = float(page.mediabox.height)
        if abs(src_w - A4_W) < 1 and abs(src_h - A4_H) < 1:
            return page
        scale_x = A4_W / src_w
        scale_y = A4_H / src_h
        scale = max(scale_x, scale_y)
        tx = (A4_W - src_w * scale) / 2
        ty = (A4_H - src_h * scale) / 2
        page.add_transformation(Transformation().scale(scale).translate(tx, ty))
        a4_page = _PO.create_blank_page(width=A4_W, height=A4_H)
        a4_page.merge_page(page)
        return a4_page

    def _normalize_pdf(self, pdf_bytes: bytes) -> bytes:
        """Ensure all pages are A4 sized, scaling if needed."""
        reader = PdfReader(BytesIO(pdf_bytes))
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(self._scale_to_a4(page))
        output = BytesIO()
        writer.write(output)
        return output.getvalue()

    def _merge_background_pdf(self, catalog_bytes: bytes, background_pdf_bytes: bytes) -> bytes:
        """Merge background PDF pages under catalog pages using PyPDF2."""
        catalog_reader = PdfReader(BytesIO(catalog_bytes))
        bg_reader = PdfReader(BytesIO(background_pdf_bytes))
        bg_count = len(bg_reader.pages)
        writer = PdfWriter()

        for i, catalog_page in enumerate(catalog_reader.pages):
            bg_idx = i % bg_count
            bg_page = PdfReader(BytesIO(background_pdf_bytes)).pages[bg_idx]
            bg_page.merge_page(catalog_page)
            writer.add_page(bg_page)

        output = BytesIO()
        writer.write(output)
        return output.getvalue()

    # ── Parallel image download ──

    async def _download_images_parallel(self, image_urls: List[str]) -> Dict[str, Dict]:
        """Download all unique images in parallel, returning resized data URLs and blurred versions."""
        unique_urls = list(set(url for url in image_urls if url))
        if not unique_urls:
            return {}

        if not HAS_HTTPX:
            # Fallback: sequential download (slow but works without httpx)
            results = {}
            for url in unique_urls:
                try:
                    resp = requests.get(url, timeout=15)
                    resp.raise_for_status()
                    raw = resp.content
                    ct = resp.headers.get('Content-Type', 'image/jpeg')
                    results[url] = {
                        'data_url': self._create_resized_data_url(raw, ct, 600),
                        'blurred_data_url': self._create_blurred_from_bytes(raw),
                    }
                except Exception:
                    pass
            return results

        results = {}
        semaphore = asyncio.Semaphore(10)

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            async def download_one(url: str):
                async with semaphore:
                    try:
                        response = await client.get(url)
                        response.raise_for_status()
                        raw = response.content
                        ct = response.headers.get('content-type', 'image/jpeg')
                        if not ct.startswith('image/'):
                            ct = 'image/jpeg'
                        return url, {
                            'data_url': self._create_resized_data_url(raw, ct, 600),
                            'blurred_data_url': self._create_blurred_from_bytes(raw),
                        }
                    except Exception:
                        return url, None

            tasks = [download_one(url) for url in unique_urls]
            responses = await asyncio.gather(*tasks)

            for url, data in responses:
                if data:
                    results[url] = data

        return results

    @staticmethod
    def _create_resized_data_url(raw_bytes: bytes, content_type: str, max_size: int = 600) -> str:
        """Resize image to max_size on longest side and return as data URL."""
        if not HAS_PIL:
            b64 = base64.b64encode(raw_bytes).decode('utf-8')
            return f"data:{content_type};base64,{b64}"
        try:
            img = Image.open(BytesIO(raw_bytes))
            if max(img.size) > max_size:
                img.thumbnail((max_size, max_size), Image.LANCZOS)
            buffer = BytesIO()
            if img.mode in ('RGBA', 'LA', 'P'):
                img.save(buffer, format='PNG', optimize=True)
                content_type = 'image/png'
            else:
                img = img.convert('RGB')
                img.save(buffer, format='JPEG', quality=85, optimize=True)
                content_type = 'image/jpeg'
            b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            return f"data:{content_type};base64,{b64}"
        except Exception:
            b64 = base64.b64encode(raw_bytes).decode('utf-8')
            return f"data:{content_type};base64,{b64}"

    @staticmethod
    def _create_blurred_from_bytes(raw_bytes: bytes) -> str:
        """Create blurred data URL from raw image bytes."""
        if not HAS_PIL:
            return ''
        try:
            img = Image.open(BytesIO(raw_bytes)).convert('RGB')
            img = img.filter(ImageFilter.GaussianBlur(radius=12))
            buffer = BytesIO()
            img.save(buffer, format='JPEG', quality=50)
            b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            return f'data:image/jpeg;base64,{b64}'
        except Exception:
            return ''

    # ── Product data preparation ──

    async def _prepare_products_data(self) -> List[dict]:
        """Prepare products data with parallel image downloads."""
        def get_product_id(p):
            if isinstance(p, dict):
                return p.get("id")
            return getattr(p, 'id', None) if p else None

        sorted_products = sorted(
            self.products,
            key=lambda p: next(
                (pos.position for pos in self.config.products if pos.id == get_product_id(p)),
                999
            )
        )

        # First pass: extract product info and collect image URLs
        products_info = []
        raw_image_urls = []
        for product in sorted_products:
            info = self._extract_product_info(product)
            raw_image_urls.append(info['image_url'])
            products_info.append(info)

        # Download all images in parallel
        image_cache = await self._download_images_parallel(raw_image_urls)

        # Second pass: attach downloaded image data
        products_data = []
        for info in products_info:
            raw_url = info['image_url']
            if raw_url and raw_url in image_cache:
                info['image_url'] = image_cache[raw_url]['data_url']
                info['blurred_image_url'] = image_cache[raw_url]['blurred_data_url']
            else:
                info['blurred_image_url'] = None
            products_data.append(info)

        return products_data

    def _extract_product_info(self, product) -> dict:
        """Extract product info into a dict without downloading images."""
        if isinstance(product, dict):
            title = product.get("title", "") or ""
            variants = product.get("variants") or []
        else:
            title = getattr(product, 'title', "") or ""
            variants = getattr(product, 'variants', []) or []

        if variants and isinstance(variants[0], dict):
            variant = variants[0]
            price = variant.get("price", 0)
            images = variant.get("images") or []
            sizes_x = variant.get("sizes_x")
            sizes_y = variant.get("sizes_y")
            sizes_z = variant.get("sizes_z")
            material = variant.get("material") or variant.get("material_type") or ""
        elif variants and hasattr(variants[0], 'price'):
            variant = variants[0]
            price = getattr(variant, 'price', 0)
            images = getattr(variant, 'images', []) or []
            sizes_x = getattr(variant, 'sizes_x', None)
            sizes_y = getattr(variant, 'sizes_y', None)
            sizes_z = getattr(variant, 'sizes_z', None)
            material = getattr(variant, 'material', "") or ""
        else:
            price = 0
            images = []
            sizes_x = sizes_y = sizes_z = None
            material = ""

        image_url = None
        if len(images) > 1:
            img = images[1]
        elif images:
            img = images[0]
        else:
            img = None
        if img:
            if isinstance(img, dict):
                image_url = img.get("src")
            else:
                image_url = getattr(img, 'src', None)

        if isinstance(product, dict):
            description = product.get("description", "") or product.get("body_html", "") or ""
            product_id = product.get("identificador") or product.get("id", "")
        else:
            description = getattr(product, 'description', "") or getattr(product, 'body_html', "") or ""
            product_id = getattr(product, 'identificador', None) or getattr(product, 'id', "")

        description = re.sub(r'<[^>]+>', '', description).strip()
        if len(description) > 110:
            description = description[:107] + "..."

        unit_price = float(price) if price else 0.0

        raw_dozen = None
        if variants and isinstance(variants[0], dict):
            raw_dozen = variants[0].get("precioDocena") or variants[0].get("precio_docena")
        elif variants and hasattr(variants[0], 'precio_docena'):
            raw_dozen = getattr(variant, 'precio_docena', None) or getattr(variant, 'precioDocena', None)

        if raw_dozen and float(raw_dozen) > 0:
            price_dozen_unit = float(raw_dozen)
        else:
            dozen_total = unit_price * 10.2
            price_dozen_unit = dozen_total / 12

        return {
            'title': title,
            'price': unit_price,
            'price_dozen_unit': price_dozen_unit,
            'image_url': image_url,
            'blurred_image_url': None,
            'width': sizes_x,
            'height': sizes_y,
            'depth': sizes_z,
            'description': description,
            'product_id': str(product_id) if product_id else "",
            'material': str(material) if material else "",
        }

    @staticmethod
    def _batch_filter(items, batch_size):
        """Jinja2 filter to batch items (like chunk)"""
        for i in range(0, len(items), batch_size):
            yield items[i:i + batch_size]


def validate_image_url(url: str) -> bool:
    """Validate image URL is accessible"""
    try:
        response = requests.head(url, timeout=10, allow_redirects=True)
        if response.status_code == 200:
            return response.headers.get('Content-Type', '').lower().startswith('image/')
        return False
    except Exception:
        return False


def estimate_pdf_pages(product_count: int, products_per_page: int = 6) -> int:
    """Estimate PDF pages (6 products per page)"""
    pages = (product_count + products_per_page - 1) // products_per_page
    return pages + 2
