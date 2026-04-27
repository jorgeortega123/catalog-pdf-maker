"""
PDF Catalog Generator - Main Application
FastAPI application for generating product catalog PDFs
"""
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse

from api.routes import router as api_router
from api.auth import router as auth_router, is_authenticated

PUBLIC_PATHS = ("/login", "/api/login", "/api/check-session", "/health")


# Create FastAPI app
app = FastAPI(
    title="PDF Catalog Generator",
    description="Generate A4 PDF catalogs from product data",
    version="1.0.0"
)

# Mount static files FIRST (before routes, avoids middleware interference)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Setup templates
templates = Jinja2Templates(directory="templates")

# Include API routes
app.include_router(auth_router)
app.include_router(api_router)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Check session on every request except public paths"""
    path = request.url.path

    # Allow public paths and static files
    if path in PUBLIC_PATHS or path.startswith("/static"):
        return await call_next(request)

    # Valid session -> proceed
    if is_authenticated(request):
        return await call_next(request)

    # No session: API -> 401, pages -> redirect to login
    if path.startswith("/api/"):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return RedirectResponse(url="/login")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Serve the login page"""
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main web interface"""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    port = 3000
    print(f"dev server -> http://127.0.0.1:{port}")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
