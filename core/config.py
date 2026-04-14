"""
Configuration for PDF Catalog Generator
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings"""

    # Backend API URL
    backend_url: str = "https://jandrea-backend.llampukaq.workers.dev"

    # PDF Settings
    pdf_margin_mm: float = 15.0
    pdf_header_height_mm: float = 50.0
    pdf_footer_height_mm: float = 30.0

    # Image Settings
    max_image_size_bytes: int = 10 * 1024 * 1024  # 10MB
    default_image_timeout_seconds: int = 30

    # PDF Generation
    max_products_warning: int = 100
    max_pdf_size_mb: int = 50

    class Config:
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()
