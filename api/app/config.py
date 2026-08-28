"""Environment configuration.

Mirrors server/src/config.ts. Locally, load a .env file with python-dotenv
before this module is imported (app/main.py does that) rather than requiring
`--env-file` flags, since Python has no built-in equivalent.
"""

import os


def _required(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name) or fallback
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


class Settings:
    database_url: str = _required(
        "DATABASE_URL", "postgres://postgres:postgres@localhost:5432/financedb"
    )

    # Irrelevant on Vercel serverless; only used by `uvicorn app.main:app --port`.
    port: int = int(os.environ.get("PORT", "8000"))

    # Comma-separated list of origins allowed to call the API directly.
    # The Expo web build is served same-origin behind Vercel rewrites, so this
    # mainly matters for local dev (Expo web/Metro) and any other origin.
    cors_origins: list[str] = [
        o.strip()
        for o in os.environ.get(
            "CORS_ORIGINS",
            "http://localhost:8081,http://localhost:19006,http://localhost:8443",
        ).split(",")
        if o.strip()
    ]

    # NOTE: unlike the Node original, which auto-detects the host's IANA
    # timezone via Intl, Python has no equally reliable stdlib way to do that
    # on every platform (and Vercel's containers run UTC regardless). Set
    # APP_TIMEZONE explicitly in every environment. Defaults to the timezone
    # implied by the seed data / INR context.
    timezone: str = os.environ.get("APP_TIMEZONE", "Asia/Kolkata")

    # Path to finance.config.json; defaults to api/config/finance.config.json.
    finance_config_path: str | None = os.environ.get("FINANCE_CONFIG")

    # Supabase project URL (Settings -> API -> Project URL). Session JWTs are
    # signed with the project's JWT Signing Keys (ES256); the public half is
    # fetched from this project's JWKS endpoint rather than a shared secret.
    # Checked lazily so importing this module without it set (e.g. during
    # local schema-only testing) doesn't crash.
    supabase_url: str | None = os.environ.get("SUPABASE_URL")


settings = Settings()
