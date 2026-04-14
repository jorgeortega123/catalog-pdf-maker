"""
Pydantic models for PDF Catalog Generator
"""
from pydantic import BaseModel, Field, HttpUrl
from typing import List, Optional


class Category(BaseModel):
    """Category model from backend"""
    id: str
    category_id: str = Field(alias="categoryId")
    title: str
    position: Optional[int] = None
    img: Optional[str] = None
    seo_title: Optional[str] = Field(default=None, alias="seoTitle")

    class Config:
        populate_by_name = True


class ProductImage(BaseModel):
    """Product image model"""
    src: str
    is_video: Optional[bool] = Field(default=False, alias="isVideo")
    need_contrast: Optional[bool] = Field(default=None, alias="needContrast")

    class Config:
        populate_by_name = True


class ProductVariant(BaseModel):
    """Product variant model"""
    price: float
    price_without_off: Optional[float] = Field(default=None, alias="priceWithoutOff")
    precio_docena: Optional[float] = Field(default=None, alias="precioDocena")
    sizes_x: Optional[float] = Field(default=None, alias="sizes_x")
    sizes_y: Optional[float] = Field(default=None, alias="sizes_y")
    sizes_z: Optional[float] = Field(default=None, alias="sizes_z")
    images: List[ProductImage] = []

    class Config:
        populate_by_name = True


class Product(BaseModel):
    """Product model from backend"""
    id: str
    title: Optional[str] = None
    description: Optional[str] = None
    category_id: str = Field(alias="categoryId")
    identificador: Optional[str] = None
    price: Optional[float] = None  # Price directly from Producto model
    in_stock: Optional[bool] = Field(default=True, alias="inStock")
    is_private: Optional[bool] = Field(default=False, alias="isPrivate")
    variants: List[ProductVariant] = []
    topic_tags: Optional[List] = Field(default=None, alias="topicTags")

    class Config:
        populate_by_name = True

    @property
    def main_price(self) -> float:
        """Get main price - prefer direct price field, fallback to variant"""
        if self.price is not None:
            return self.price
        return self.variants[0].price if self.variants else 0.0

    @property
    def main_image(self) -> Optional[str]:
        """Get first image from first variant"""
        if self.variants and self.variants[0].images:
            return self.variants[0].images[0].src
        return None

    @property
    def measurements(self) -> str:
        """Get formatted measurements string"""
        v = self.variants[0] if self.variants else None
        if not v:
            return "N/A"
        parts = []
        if v.sizes_x:
            parts.append(f"{v.sizes_x}mm")
        if v.sizes_y:
            parts.append(f"{v.sizes_y}mm")
        if v.sizes_z:
            parts.append(f"{v.sizes_z}mm")
        return " × ".join(parts) if parts else "N/A"


class ImagesConfig(BaseModel):
    """Images configuration for PDF"""
    cover_url: str = Field(alias="coverUrl")
    background_url: str = Field(alias="backgroundUrl")
    back_cover_url: str = Field(alias="backCoverUrl")

    class Config:
        populate_by_name = True


class ProductOrder(BaseModel):
    """Product with custom position"""
    id: str
    position: int = Field(ge=1)


class PDFConfig(BaseModel):
    """Complete configuration for PDF generation"""
    category_id: str = Field(alias="categoryId")
    products_per_page: int = Field(default=4, ge=1, le=10, alias="productsPerPage")
    images: ImagesConfig
    products: List[ProductOrder] = []

    class Config:
        populate_by_name = True


class ProductsResponse(BaseModel):
    """Response from products endpoint"""
    productos: List[Product]
    has_next_page: Optional[bool] = Field(default=None, alias="hasNextPage")

    class Config:
        populate_by_name = True
