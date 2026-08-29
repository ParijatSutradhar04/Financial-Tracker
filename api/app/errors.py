"""HTTP error type + FastAPI exception handlers. Mirrors server/src/errors.ts."""

from __future__ import annotations

import logging

import asyncpg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("finance_api")


class HttpError(Exception):
    def __init__(self, status_code: int, message: str, details: object = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.details = details


def bad_request(message: str, details: object = None) -> HttpError:
    return HttpError(400, message, details)


def not_found(message: str) -> HttpError:
    return HttpError(404, message)


_CHECK_VIOLATION = "23514"
_FOREIGN_KEY_VIOLATION = "23503"
_UNIQUE_VIOLATION = "23505"
_RAISE_EXCEPTION = "P0001"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HttpError)
    async def _http_error(_: Request, exc: HttpError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.message, "details": exc.details},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # loc[0] is always "body" or "query"/"path" for FastAPI-parsed params;
        # drop it so the reported path matches what the Zod-based API sent
        # (e.g. "accountId" rather than "body.accountId").
        details = [
            {"path": ".".join(str(p) for p in e["loc"][1:]) or str(e["loc"][-1]), "message": e["msg"]}
            for e in exc.errors()
        ]
        return JSONResponse(status_code=400, content={"error": "Invalid request body", "details": details})

    @app.exception_handler(asyncpg.PostgresError)
    async def _pg_error(_: Request, exc: asyncpg.PostgresError) -> JSONResponse:
        # The schema enforces amount > 0, the credit/debit enum, valid account
        # references, and transaction immutability at the database level. All
        # of those mean the caller sent something invalid, not that the server
        # broke.
        code = getattr(exc, "sqlstate", None)
        if code in (_CHECK_VIOLATION, _FOREIGN_KEY_VIOLATION, _UNIQUE_VIOLATION, _RAISE_EXCEPTION):
            return JSONResponse(status_code=400, content={"error": str(exc)})
        logger.exception("Unhandled Postgres error")
        return JSONResponse(status_code=500, content={"error": "Internal server error"})

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception")
        return JSONResponse(status_code=500, content={"error": "Internal server error"})
