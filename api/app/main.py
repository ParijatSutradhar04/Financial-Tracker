"""FastAPI app assembly. Mirrors server/src/index.ts's middleware/router wiring.

Unlike the Express original, there is no top-level `await provisionAccounts()`
here — that ran once per cold start there, which is exactly the pattern that
breaks on serverless. Provisioning is now a deploy-time step
(scripts/provision.py). There is also no `app.listen`: this module exports
`app`, and Vercel's Python runtime (or uvicorn locally) serves it directly.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

# Load a local .env before any settings are read. No-op in production, where
# real env vars are already set by the platform.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_auth
from .config import settings
from .errors import register_exception_handlers
from .routes import accounts, categories, config, credits, health, payday, reconcile, salary, transactions, transfers

app = FastAPI(title="Financial Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# Health is unauthenticated so uptime checks and deploy tooling don't need a
# token; every other route requires a verified Supabase JWT.
app.include_router(health.router, prefix="/api/health")
app.include_router(config.router, prefix="/api/config", dependencies=[require_auth])
app.include_router(accounts.router, prefix="/api/accounts", dependencies=[require_auth])
app.include_router(categories.router, prefix="/api/categories", dependencies=[require_auth])
app.include_router(credits.router, prefix="/api/credits", dependencies=[require_auth])
app.include_router(transactions.router, prefix="/api/transactions", dependencies=[require_auth])
app.include_router(transfers.router, prefix="/api/transfers", dependencies=[require_auth])
app.include_router(salary.router, prefix="/api/salary", dependencies=[require_auth])
app.include_router(reconcile.router, prefix="/api/reconcile", dependencies=[require_auth])
app.include_router(payday.router, prefix="/api/payday", dependencies=[require_auth])
