"""
Authentication module - JWT-based session with 7-day expiry
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel
import hashlib
import hmac

from core.config import settings

router = APIRouter(prefix="/api")

SESSION_DAYS = 7
MAX_ATTEMPTS = 5
BLOCK_SECONDS = 3600  # 1 hour

# In-memory: {ip: {"count": int, "blocked_until": datetime|None}}
_attempts: dict = {}


def _get_ip(request: Request) -> str:
    return request.client.host if request.client else "0"


def _check_blocked(ip: str):
    """Raise 429 if IP is blocked"""
    entry = _attempts.get(ip)
    if not entry:
        return
    until = entry.get("blocked_until")
    if until and datetime.now(timezone.utc) < until:
        remaining = int((until - datetime.now(timezone.utc)).total_seconds() / 60)
        raise HTTPException(
            status_code=429,
            detail=f"Bloqueado. Intenta de nuevo en {remaining} minutos."
        )
    # Expired -> reset
    if until:
        _attempts.pop(ip, None)


def _fail(ip: str):
    """Record a failed attempt, block if limit reached"""
    entry = _attempts.setdefault(ip, {"count": 0, "blocked_until": None})
    entry["count"] += 1
    if entry["count"] >= MAX_ATTEMPTS:
        entry["blocked_until"] = datetime.now(timezone.utc) + timedelta(seconds=BLOCK_SECONDS)


def _remaining(ip: str) -> int:
    return MAX_ATTEMPTS - _attempts.get(ip, {}).get("count", 0)


def _reset(ip: str):
    _attempts.pop(ip, None)


def _create_token() -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    expires_str = expires.strftime("%Y-%m-%dT%H:%M:%S")
    sig = hmac.new(
        settings.jwt_secret.encode(), expires_str.encode(), hashlib.sha256
    ).hexdigest()
    return f"{expires_str}.{sig}"


def _verify_token(token: str) -> bool:
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False
        expires_str, sig = parts
        expected = hmac.new(
            settings.jwt_secret.encode(), expires_str.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        expires = datetime.strptime(expires_str, "%Y-%m-%dT%H:%M:%S").replace(
            tzinfo=timezone.utc
        )
        return datetime.now(timezone.utc) < expires
    except Exception:
        return False


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get("session")
    return bool(token and _verify_token(token))


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(data: LoginRequest, request: Request):
    ip = _get_ip(request)

    # Check if blocked FIRST
    _check_blocked(ip)

    # Validate credentials
    if data.email != settings.email or data.password != settings.password:
        _fail(ip)
        left = _remaining(ip)
        if left <= 0:
            raise HTTPException(
                status_code=429,
                detail=f"Bloqueado. Intenta de nuevo en {BLOCK_SECONDS // 60} minutos."
            )
        raise HTTPException(
            status_code=401,
            detail=f"Credenciales incorrectas. Intentos restantes: {left}"
        )

    # Success -> reset attempts, set cookie
    _reset(ip)
    token = _create_token()
    response = Response(content='{"ok":true}', media_type="application/json", status_code=200)
    response.set_cookie(
        key="session",
        value=token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
    )
    return response


@router.post("/logout")
async def logout():
    response = Response(content='{"ok":true}', media_type="application/json", status_code=200)
    response.delete_cookie(key="session")
    return response


@router.get("/check-session")
async def check_session(request: Request):
    if is_authenticated(request):
        return {"authenticated": True}
    return {"authenticated": False}
