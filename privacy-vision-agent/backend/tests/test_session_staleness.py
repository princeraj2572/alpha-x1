"""
Tests for SessionData.is_stale.

Regression coverage: is_stale was declared as a @property that took a
`timeout_seconds` argument, which a property can never actually receive —
`session.is_stale` evaluates immediately with only the 300s default, and
`session.is_stale(60)` raises `TypeError: 'bool' object is not callable`
rather than checking a 60s threshold.
"""

from datetime import datetime, timedelta, timezone

from app.services.session import SessionData


def _session(seconds_since_heartbeat: float) -> SessionData:
    now = datetime.now(timezone.utc)
    return SessionData(
        session_id="s1",
        created_at=now,
        last_heartbeat=now - timedelta(seconds=seconds_since_heartbeat),
    )


def test_is_stale_uses_default_300s_threshold():
    assert _session(301).is_stale() is True
    assert _session(299).is_stale() is False


def test_is_stale_accepts_a_custom_threshold():
    session = _session(90)
    assert session.is_stale(timeout_seconds=60) is True
    assert session.is_stale(timeout_seconds=120) is False
