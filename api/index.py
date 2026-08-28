"""Vercel Python entrypoint.

Vercel's Python runtime looks for a module-level `app` (ASGI) object in this
file. The real app is assembled in app/main.py; this file only re-exports it
so the FastAPI app can also be imported and run locally the normal way
(`uvicorn app.main:app --reload`, from the /api directory).
"""

from app.main import app

__all__ = ["app"]
