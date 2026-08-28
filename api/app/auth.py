"""Supabase JWT verification.

The frontend logs in via supabase-js, gets back a session JWT, and sends it
as `Authorization: Bearer <jwt>` on every /api request. Session JWTs are
signed with the Supabase project's JWT Signing Keys (ES256), so this
dependency verifies against the project's public JWKS rather than a shared
secret, and rejects anything missing, malformed, or expired. Applied to
every route except /api/health.
"""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

from .config import settings

_jwk_client: PyJWKClient | None = None


def _get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        # PyJWKClient caches fetched keys in-process (keyed by kid), so this
        # only hits the network on an unseen kid, e.g. after a key rotation.
        _jwk_client = PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")
    return _jwk_client


def get_current_user(request: Request) -> dict:
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header or not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    if not settings.supabase_url:
        raise HTTPException(status_code=500, detail="Server auth is not configured")

    token = header[7:].strip()
    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    return payload


require_auth = Depends(get_current_user)
