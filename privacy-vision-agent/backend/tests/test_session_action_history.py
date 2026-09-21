"""
Tests for SessionManager's action-loop tracking (DECISION-014): joining
action_result payloads back to what was actually sent, consecutive-failure
counting, and history bounding.
"""

from app.services.session import (
    SessionManager,
    MAX_ACTION_HISTORY,
    CONSECUTIVE_FAILURE_WARNING_THRESHOLD,
)


def test_record_action_result_joins_back_to_sent_action():
    mgr = SessionManager()
    session_id = mgr.create_session()

    mgr.record_sent_action(
        session_id, "msg-1", {"action_type": "click", "target_id": "btn-1", "reason": "log in"}
    )
    session = mgr.record_action_result(session_id, "msg-1", {"success": True})

    assert session is not None
    assert session.action_history == [
        {"action_type": "click", "target_id": "btn-1", "reason": "log in", "success": True, "error": None}
    ]
    # Joined and consumed — a second result for the same message_id has nothing to join to.
    assert "msg-1" not in session.pending_actions


def test_consecutive_failures_reset_on_success():
    mgr = SessionManager()
    session_id = mgr.create_session()

    mgr.record_action_result(session_id, None, {"success": False, "error": "not found"})
    mgr.record_action_result(session_id, None, {"success": False, "error": "not found"})
    session = mgr.record_action_result(session_id, None, {"success": True})

    assert session.consecutive_failures == 0

    mgr.record_action_result(session_id, None, {"success": False, "error": "x"})
    session = mgr.record_action_result(session_id, None, {"success": False, "error": "x"})
    assert session.consecutive_failures == 2


def test_consecutive_failures_hits_warning_threshold():
    mgr = SessionManager()
    session_id = mgr.create_session()

    session = None
    for _ in range(CONSECUTIVE_FAILURE_WARNING_THRESHOLD):
        session = mgr.record_action_result(session_id, None, {"success": False, "error": "x"})

    assert session.consecutive_failures == CONSECUTIVE_FAILURE_WARNING_THRESHOLD


def test_action_history_bounded():
    mgr = SessionManager()
    session_id = mgr.create_session()

    for i in range(MAX_ACTION_HISTORY + 5):
        mgr.record_action_result(session_id, None, {"success": True})

    history = mgr.get_action_history(session_id)
    assert len(history) == MAX_ACTION_HISTORY


def test_record_action_result_for_unknown_session_returns_none():
    mgr = SessionManager()
    assert mgr.record_action_result("does-not-exist", "msg-1", {"success": True}) is None


def test_get_action_history_for_unknown_session_is_empty():
    mgr = SessionManager()
    assert mgr.get_action_history("does-not-exist") == []
