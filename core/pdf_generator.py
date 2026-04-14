"""
PDF Generator using pdfkit + Jinja2
Creates modern A4 PDF catalogs with HTML/CSS templates
"""
import os
from io import BytesIO
from typing import List
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

    def generate(self) -> bytes:
        """Generate PDF and return as bytes"""
        if not HAS_PDFKIT:
            raise ImportError("pdfkit is not installed. Install it with: pip install pdfkit")

        if not HAS_JINJA2:
            raise ImportError("Jinja2 is not installed. Install it with: pip install jinja2")

        # Check if wkhtmltopdf is available
        # Windows default installation path
        wkhtmltopdf_path = r'C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe'
        if not os.path.exists(wkhtmltopdf_path):
            # Try alternate location
            wkhtmltopdf_path = r'C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe'

        if os.path.exists(wkhtmltopdf_path):
            config = pdfkit.configuration(wkhtmltopdf=wkhtmltopdf_path)
        else:
            try:
                config = pdfkit.configuration()
            except:
                raise RuntimeError(
                    "wkhtmltopdf is not installed. "
                    "Install it from: https://wkhtmltopdf.org/downloads.html"
                )

        # Prepare product data for template
        products_data = self._prepare_products_data()

        # Get image URLs
        cover_url = self.config.images.cover_url if self.config.images else None
        background_url = self.config.images.background_url if self.config.images else None
        back_cover_url = self.config.images.back_cover_url if self.config.images else None

        # Render template
        template = self.env.get_template('catalog.html')
        html_content = template.render(
            products=products_data,
            category_name=self.category_name,
            cover_url=cover_url,
            background_url=background_url,
            back_cover_url=back_cover_url
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

        pdf_bytes = pdfkit.from_string(html_content, False, options=pdf_options, configuration=config)

        return pdf_bytes

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
            elif variants and hasattr(variants[0], 'price'):
                variant = variants[0]
                price = getattr(variant, 'price', 0)
                images = getattr(variant, 'images', []) or []
                sizes_x = getattr(variant, 'sizes_x', None)
                sizes_y = getattr(variant, 'sizes_y', None)
                sizes_z = getattr(variant, 'sizes_z', None)
            else:
                price = 0
                images = []
                sizes_x = sizes_y = sizes_z = None

            # Get image URL
            image_url = None
            if images:
                if isinstance(images[0], dict):
                    image_url = images[0].get("src")
                else:
                    image_url = getattr(images[0], 'src', None)

            products_data.append({
                'title': title,
                'price': float(price) if price else 0.0,
                'image_url': image_url,
                'width': sizes_x,
                'height': sizes_y,
                'depth': sizes_z
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


def estimate_pdf_pages(product_count: int, products_per_page: int = 3) -> int:
    """Estimate PDF pages (3 products per page)"""
    pages = (product_count + products_per_page - 1) // products_per_page
    return pages + 2  # +2 for cover and back cover


# Legacy ReportLab functions removed - using pdfkit + Jinja2 now
