# PDF Catalog Generator - AI Agent Guide

## Project Overview

**PDF Catalog Generator** is a FastAPI web application that generates professional A4 PDF catalogs from product data. Users can select products by category, customize images (cover, background, back cover), configure layouts, and reorder products before generating the PDF.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | FastAPI (Python 3.11+) |
| PDF Generation | pdfkit + wkhtmltopdf + Jinja2 templates |
| Frontend | Vanilla JavaScript + HTML5 + CSS3 |
| Data Models | Pydantic |
| Image Processing | Pillow, requests |
| HTTP Client | httpx (async), requests |

## Architecture

```
PDF_MAKER/
├── main.py                    # FastAPI app entry point
├── api/
│   ├── routes.py             # API endpoints (/api/categories, /api/products, /api/generate-pdf)
│   └── proxy.py              # Proxy to external backend (jandrea-backend)
├── core/
│   ├── models.py             # Pydantic models (Category, Product, PDFConfig, etc.)
│   ├── config.py             # Settings from env vars or defaults
│   └── pdf_generator.py      # PDFGenerator class using pdfkit + Jinja2
├── templates/
│   ├── index.html            # Main web UI
│   ├── base.html             # Base template
│   └── catalog.html          # PDF template (HTML for pdfkit)
├── static/
│   ├── css/styles.css        # UI styles
│   └── js/app.js             # Frontend logic (PDFCatalogApp class)
└── requirements.txt
```

## Key Components

### 1. PDFGenerator (`core/pdf_generator.py`)

The core class that generates PDFs:

```python
generator = PDFGenerator(config, ordered_products, category.title)
pdf_bytes = generator.generate()
```

**Important:** On Windows, pdfkit requires wkhtmltopdf installed at:
- `C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe`
- Path is configured in `generate()` method

### 2. PDF Template (`templates/catalog.html`)

Jinja2 template rendered to HTML, then converted to PDF by pdfkit.

**Current layout (v2.0):** 4 products per page in 2×2 grid, compact vertical cards
**Page size:** A4 (210mm x 297mm)
**Design:** Premium magazine style with Playfair Display + Inter fonts

### 3. API Routes (`api/routes.py`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/categories` | GET | Fetch all categories |
| `/api/products/{category_id}` | GET | Get products for a category |
| `/api/validate-images` | POST | Validate image URLs |
| `/api/estimate-pages` | POST | Estimate PDF page count |
| `/api/generate-pdf` | POST | Generate and return PDF |

### 4. Frontend App (`static/js/app.js`)

`PDFCatalogApp` class manages:
- Category selection and product loading
- Image URL configuration with localStorage persistence
- Product reordering (drag & drop, buttons)
- PDF generation with progress feedback

## Data Models

### Product Structure

```python
{
    "id": str,
    "title": str,
    "categoryId": str,
    "variants": [{
        "price": float,
        "sizes_x": float,  # width in mm
        "sizes_y": float,  # height in mm
        "sizes_z": float,  # depth in mm
        "images": [{"src": str}]
    }]
}
```

### PDFConfig Structure

```python
{
    "categoryId": str,
    "productsPerPage": int,  # 4 (2×2 grid layout)
    "images": {
        "coverUrl": str,
        "backgroundUrl": str,
        "backCoverUrl": str
    },
    "products": [{"id": str, "position": int}]
}
```

## Configuration

Environment variables (`.env` file):

```env
BACKEND_URL=https://jandrea-backend.llampukaq.workers.dev
PDF_MARGIN_MM=15.0
MAX_IMAGE_SIZE_BYTES=10485760
```

## Known Issues & Improvements Needed

### PDF Design Issues (RESOLVED in v2.0)
~~1. Layout inefficiency: Only 3 products per page with large horizontal cards~~ → **FIXED: Now 4 products per page (2×2 grid)**
~~2. Typography: Generic Inter font, could use better hierarchy~~ → **FIXED: Playfair Display + Inter combo**
~~3. Color scheme: Basic purple gradient, could be more refined~~ → **FIXED: Sophisticated navy/coral palette**
~~4. Product cards: Horizontal layout wastes space~~ → **FIXED: Compact vertical cards**
~~5. Spacing: Large margins reduce usable space~~ → **FIXED: Optimized with header/footer**

### Code Issues
1. **Windows hardcoding:** wkhtmltopdf path is Windows-specific
2. ~~productsPerPage config: Not actually used in template~~ → **FIXED: Now respects batch(4)**
3. **Error handling:** Generic error messages, no specific feedback
4. **Image loading:** No fallback for failed images in PDF

## Quick Start for Agents

### To modify PDF layout:

1. Edit `templates/catalog.html` - CSS and HTML structure
2. Adjust `batch()` filter size in template (currently `batch(4)` for 2×2 grid)
3. Modify grid columns/rows in `.products-container` CSS
4. Test by generating a PDF from the web UI

### To add new API endpoints:

1. Add route handler in `api/routes.py`
2. Update `static/js/app.js` to call the endpoint
3. Add Pydantic models to `core/models.py` if needed

### To change PDF styling:

Edit CSS in `<style>` block within `templates/catalog.html`:
- `.pdf-page` - page dimensions and margins
- `.product-card` - individual product appearance
- `.cover-page`, `.back-cover` - cover styling

### Common Tasks

**Change products per page:**
```html
<!-- In catalog.html, change batch size -->
{% for page_products in products|batch(4) %}  <!-- 4 products per page (2×2) -->
{% for page_products in products|batch(6) %}  <!-- 6 products per page (2×3) -->
```

**Add new product field:**
1. Update `_prepare_products_data()` in `pdf_generator.py`
2. Add field to template in `catalog.html`

**Fix wkhtmltopdf path on Linux/Mac:**
Edit `pdf_generator.py`, line ~62-65

## External Dependencies

- **wkhtmltopdf** must be installed separately (https://wkhtmltopdf.org/downloads.html)
- Backend API at `jandrea-backend.llampukaq.workers.dev` must be accessible

## Testing

Manual testing via web UI at `http://localhost:8000`:
1. Select a category
2. Configure images (optional - stored in localStorage)
3. Reorder products if needed
4. Click "Generar PDF"
5. Verify PDF output

## License

Internal use project.
