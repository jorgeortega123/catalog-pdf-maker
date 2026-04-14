"""
Proxy module for Cloudflare Workers backend API
"""
from typing import List, Optional
import httpx

from core.models import Category, ProductsResponse
from core.config import settings


class BackendProxy:
    """Proxy to the Cloudflare Workers backend"""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url or settings.backend_url
        self.timeout = 30.0

    async def get_categories(self) -> List[Category]:
        """Get all categories from backend"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(f"{self.base_url}/categories")
            response.raise_for_status()
            data = response.json()
            return [Category(**cat) for cat in data]

    async def get_products_by_category(self, category_id: str, all_products: bool = True) -> ProductsResponse:
        """Get products by category from backend"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            url = f"{self.base_url}/categories/products/by-category/{category_id}"
            params = {"all": "true" if all_products else "false"}
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            return ProductsResponse(**data)

    async def validate_category(self, category_id: str) -> bool:
        """Check if a category exists and has products"""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                # Check category exists
                response = await client.get(f"{self.base_url}/categories")
                response.raise_for_status()
                categories = response.json()

                cat_exists = any(cat.get("categoryId") == category_id or cat.get("id") == category_id
                                for cat in categories)

                if not cat_exists:
                    return False

                # Check has products
                products_response = await self.get_products_by_category(category_id)
                return len(products_response.productos) > 0

            except Exception:
                return False

    async def get_product_image_urls(self, category_id: str) -> List[str]:
        """Get all product image URLs for a category (for validation)"""
        products_response = await self.get_products_by_category(category_id)
        urls = []
        for product in products_response.productos:
            if product.main_image:
                urls.append(product.main_image)
        return urls


# Singleton instance
backend_proxy = BackendProxy()
