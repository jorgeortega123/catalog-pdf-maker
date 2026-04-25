"""
PDF Generator using pdfkit + Jinja2
Creates modern A4 PDF catalogs with HTML/CSS templates
"""
import os
from io import BytesIO
from typing import List, Optional
import requests

try:
    import pdfkit
    HAS_PDFKIT = True
except ImportError:
    HAS_PDFKIT = False

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

from .models import PDFConfig


class PDFGenerator:
    """Generates A4 PDF catalogs using pdfkit + Jinja2 templates"""

    def __init__(self, config: PDFConfig, products: List, category_name: str, template_dir: str = None):
        self.config = config
        self.products = products
        self.category_name = category_name

        # Template directory (default to templates/ folder)
        if template_dir is None:
            # Get the directory containing this file
            current_dir = os.path.dirname(os.path.abspath(__file__))
            template_dir = os.path.join(os.path.dirname(current_dir), 'templates')

        self.template_dir = template_dir

        # Set up Jinja2 environment
        if HAS_JINJA2:
            self.env = Environment(
                loader=FileSystemLoader(template_dir),
                autoescape=select_autoescape(['html', 'xml'])
            )
            # Register custom filter for batch
            self.env.filters['batch'] = self._batch_filter
        else:
            self.env = None

    def generate(self, cover_pdf_bytes: Optional[bytes] = None, back_cover_pdf_bytes: Optional[bytes] = None) -> bytes:
        """Generate PDF and return as bytes. Optionally merge with cover/back cover PDFs."""
        if not HAS_PDFKIT:
            raise ImportError("pdfkit is not installed. Install it with: pip install pdfkit")

        if not HAS_JINJA2:
            raise ImportError("Jinja2 is not installed. Install it with: pip install jinja2")

        # Detectar wkhtmltopdf según el sistema operativo
        import platform
        if platform.system() == "Windows":
            candidates = [
                r'C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe',
                r'C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe',
            ]
            wkhtmltopdf_path = next((p for p in candidates if os.path.exists(p)), None)
        else:
            # Linux/Docker: usar el wrapper con Xvfb si existe, sino el binario directo
            candidates = [
                '/usr/local/bin/wkhtmltopdf-xvfb',
                '/usr/bin/wkhtmltopdf',
            ]
            wkhtmltopdf_path = next((p for p in candidates if os.path.exists(p)), None)

        if wkhtmltopdf_path:
            config = pdfkit.configuration(wkhtmltopdf=wkhtmltopdf_path)
        else:
            try:
                config = pdfkit.configuration()
            except:
                raise RuntimeError(
                    "wkhtmltopdf no encontrado. "
                    "Instálalo desde: https://wkhtmltopdf.org/downloads.html"
                )

        # Prepare product data for template
        products_data = self._prepare_products_data()

        # Get background URL (cover/back cover come as uploaded PDFs)
        background_url = self.config.images.background_url if self.config.images else None

        # Skip cover/back cover in HTML if PDFs are provided
        skip_cover = cover_pdf_bytes is not None
        skip_back_cover = back_cover_pdf_bytes is not None

        # Render template
        template = self.env.get_template('catalog.html')
        html_content = template.render(
            products=products_data,
            category_name=self.category_name,
            cover_url=None,
            background_url=background_url,
            back_cover_url=None,
            skip_cover=skip_cover,
            skip_back_cover=skip_back_cover
        )

        # Convert HTML to PDF
        pdf_options = {
            'page-size': 'A4',
            'margin-top': '0',
            'margin-right': '0',
            'margin-bottom': '0',
            'margin-left': '0',
            'encoding': 'UTF-8',
            'no-outline': None,
            'enable-local-file-access': None,
            'disable-smart-shrinking': '',
            'quiet': '',
        }

        catalog_bytes = pdfkit.from_string(html_content, False, options=pdf_options, configuration=config)

        # If no cover/back cover PDFs to merge, return catalog as-is
        if not cover_pdf_bytes and not back_cover_pdf_bytes:
            return catalog_bytes

        # Merge PDFs using PyPDF2
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

    def _prepare_products_data(self) -> List[dict]:
        """Prepare products data for template rendering"""
        def get_product_id(p):
            if isinstance(p, dict):
                return p.get("id")
            return getattr(p, 'id', None) if p else None

        # Sort products by position
        sorted_products = sorted(
            self.products,
            key=lambda p: next(
                (pos.position for pos in self.config.products if pos.id == get_product_id(p)),
                999
            )
        )

        # Extract and format product data
        products_data = []
        for product in sorted_products:
            if isinstance(product, dict):
                title = product.get("title", "") or ""
                variants = product.get("variants") or []
            else:
                title = getattr(product, 'title', "") or ""
                variants = getattr(product, 'variants', []) or []

            # Get first variant
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

            # Get image URL
            image_url = None
            if images:
                if isinstance(images[0], dict):
                    image_url = images[0].get("src")
                else:
                    image_url = getattr(images[0], 'src', None)

            if isinstance(product, dict):
                description = product.get("description", "") or product.get("body_html", "") or ""
                product_id = product.get("identificador") or product.get("id", "")
            else:
                description = getattr(product, 'description', "") or getattr(product, 'body_html', "") or ""
                product_id = getattr(product, 'identificador', None) or getattr(product, 'id', "")

            # Strip HTML tags from description
            import re
            description = re.sub(r'<[^>]+>', '', description).strip()
            if len(description) > 75:
                description = description[:72] + "..."

            unit_price = float(price) if price else 0.0
            dozen_total = unit_price * 9
            dozen_unit = dozen_total / 12

            products_data.append({
                'title': title,
                'price': unit_price,
                'price_dozen_total': dozen_total,
                'price_dozen_unit': dozen_unit,
                'image_url': image_url,
                'width': sizes_x,
                'height': sizes_y,
                'depth': sizes_z,
                'description': description,
                'product_id': str(product_id) if product_id else "",
                'material': str(material) if material else "",
            })

        return products_data

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
    return pages + 2  # +2 for cover and back cover


# Legacy ReportLab functions removed - using pdfkit + Jinja2 now
