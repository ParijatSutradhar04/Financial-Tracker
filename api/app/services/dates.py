"""Date helpers. Mirrors server/src/services/dates.ts."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def today_iso(tz_name: str, now: datetime | None = None) -> str:
    """Today's calendar date in the given IANA timezone, as YYYY-MM-DD."""
    moment = now or datetime.now(timezone.utc)
    return moment.astimezone(ZoneInfo(tz_name)).date().isoformat()


def parse_iso_date(iso: str) -> tuple[int, int, int]:
    year_s, month_s, day_s = iso.split("-")
    return int(year_s), int(month_s), int(day_s)


def days_between(from_iso: str, to_iso: str) -> int:
    """Calendar days between two YYYY-MM-DD dates.

    Anchored to UTC noon so that a daylight-saving shift in between cannot
    round the difference to the wrong day.
    """
    fy, fm, fd = parse_iso_date(from_iso)
    ty, tm, td = parse_iso_date(to_iso)
    from_dt = datetime(fy, fm, fd, 12, tzinfo=timezone.utc)
    to_dt = datetime(ty, tm, td, 12, tzinfo=timezone.utc)
    return round((to_dt - from_dt).total_seconds() / 86_400)


def iso_z(dt: datetime) -> str:
    """Format a datetime the same way JavaScript's Date#toISOString does.

    asyncpg returns timestamptz columns as timezone-aware datetimes; Postgres
    NUMERIC/timestamp precision means microseconds can be nonzero, so this
    truncates to milliseconds like the JS Date type does.
    """
    dt_utc = dt.astimezone(timezone.utc)
    millis = dt_utc.microsecond // 1000
    return dt_utc.strftime("%Y-%m-%dT%H:%M:%S") + f".{millis:03d}Z"
