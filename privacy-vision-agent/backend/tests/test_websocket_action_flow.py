"""
Tests for the outbound-action-validation and history-merging additions to
handle_context_message (DECISION-014). Drives the handler directly with a
fake websocket + fake reasoning service rather than a real WS connection.
"""

import asyncio
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

from app.api.websocket_handler import handle_context_message, session_manager
from app.providers.base import ActionResponse
from app.schemas.messages import MessageEnvelope


class _FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        self.sent.append(data)


def _make_incoming(session_id: str, payload: dict) -> MessageEnvelope:
    return MessageEnvelope(
        session_id=session_id,
        message_id=str(uuid4()),
        type="context",
        timestamp=datetime.utcnow(),
        payload=payload,
    )


def _make_app(action: ActionResponse):
    async def reason_about_action(**kwargs):
        reason_about_action.calls.append(kwargs)
        return action

    reason_about_action.calls = []
    return SimpleNamespace(state=SimpleNamespace(reasoning=SimpleNamespace(reason_about_action=reason_about_action)))


def test_invalid_action_is_swapped_for_a_safe_wait():
    session_id = session_manager.create_session()
    ws = _FakeWebSocket()
    # A "click" with no target_id — exactly what action_validator rejects.
    bad_action = ActionResponse(action_type="click", target_id=None, confidence=0.9, reason="click it")
    app = _make_app(bad_action)
    incoming = _make_incoming(session_id, {"context": {}, "task": "do it"})

    asyncio.run(handle_context_message(ws, session_id, incoming, app))

    assert len(ws.sent) == 1
    sent_payload = ws.sent[0]["payload"]
    assert sent_payload["action_type"] == "wait"
    assert "Rejected invalid action" in sent_payload["reason"]


def test_valid_action_passes_through_and_is_recorded_as_pending():
    session_id = session_manager.create_session()
    ws = _FakeWebSocket()
    good_action = ActionResponse(action_type="click", target_id="btn-1", confidence=0.9, reason="click it")
    app = _make_app(good_action)
    incoming = _make_incoming(session_id, {"context": {}, "task": "do it"})

    asyncio.run(handle_context_message(ws, session_id, incoming, app))

    assert len(ws.sent) == 1
    sent = ws.sent[0]
    assert sent["payload"]["action_type"] == "click"
    assert sent["payload"]["target_id"] == "btn-1"

    session = session_manager.get_session(session_id)
    assert sent["message_id"] in session.pending_actions
    assert session.pending_actions[sent["message_id"]]["target_id"] == "btn-1"


def test_history_falls_back_to_server_tracked_when_extension_sends_none():
    session_id = session_manager.create_session()
    session_manager.record_action_result(session_id, None, {"success": True})
    ws = _FakeWebSocket()
    action = ActionResponse(action_type="wait", duration_ms=500, confidence=0.9)
    app = _make_app(action)
    # No "history" key at all — matches the real extension today.
    incoming = _make_incoming(session_id, {"context": {}, "task": "do it"})

    asyncio.run(handle_context_message(ws, session_id, incoming, app))

    calls = app.state.reasoning.reason_about_action.calls
    assert len(calls) == 1
    assert calls[0]["history"] == session_manager.get_action_history(session_id)
    assert len(calls[0]["history"]) == 1


def test_history_prefers_extension_provided_history_when_present():
    session_id = session_manager.create_session()
    session_manager.record_action_result(session_id, None, {"success": True})
    ws = _FakeWebSocket()
    action = ActionResponse(action_type="wait", duration_ms=500, confidence=0.9)
    app = _make_app(action)
    client_history = [{"action_type": "scroll", "success": True}]
    incoming = _make_incoming(session_id, {"context": {}, "task": "do it", "history": client_history})

    asyncio.run(handle_context_message(ws, session_id, incoming, app))

    calls = app.state.reasoning.reason_about_action.calls
    assert calls[0]["history"] == client_history
