"""
WebSocket endpoint for extension communication
"""

import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from datetime import datetime
from uuid import uuid4
import logging

from ..services.session import SessionManager
from ..services.action_validator import ActionValidator
from ..schemas.messages import MessageEnvelope, ErrorPayload

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])

# Global session manager
session_manager = SessionManager(timeout_seconds=300)

# Action validator
action_validator = ActionValidator()

# Active WebSocket connections: session_id -> websocket
active_connections: dict[str, WebSocket] = {}

# Heartbeat tracking: session_id -> (sequence, last_sent)
heartbeat_state: dict[str, int] = {}


async def send_message(websocket: WebSocket, message: MessageEnvelope) -> None:
    """Send a message to a WebSocket client"""
    try:
        await websocket.send_json(message.model_dump(mode="json"))
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        raise


async def send_heartbeat(session_id: str) -> bool:
    """Send heartbeat to a specific session"""
    if session_id not in active_connections:
        return False

    websocket = active_connections[session_id]
    sequence = heartbeat_state.get(session_id, 0) + 1
    heartbeat_state[session_id] = sequence

    message = MessageEnvelope(
        protocol_version="1.0",
        session_id=session_id,
        message_id=str(uuid4()),
        type="heartbeat",
        timestamp=datetime.utcnow(),
        payload={
            "sequence": sequence,
            "server_timestamp": datetime.utcnow().isoformat(),
        },
    )

    try:
        await send_message(websocket, message)
        session_manager.record_heartbeat(session_id)
        return True
    except Exception as e:
        logger.error(f"Heartbeat failed for {session_id}: {e}")
        return False


async def broadcast_heartbeat() -> None:
    """Send heartbeat to all active sessions every 30 seconds"""
    while True:
        await asyncio.sleep(30)
        sessions = list(active_connections.keys())
        for session_id in sessions:
            try:
                await send_heartbeat(session_id)
            except Exception as e:
                logger.error(f"Heartbeat error for {session_id}: {e}")


async def handle_context_message(
    websocket: WebSocket,
    session_id: str,
    incoming: MessageEnvelope,
    app
) -> None:
    """Handle DOM context message and request reasoning from cloud model"""
    try:
        reasoning_service = app.state.reasoning
        payload = incoming.payload

        logger.info(f"[Context Handler] Received context from {session_id}")

        # Call reasoning service to get next action
        action = await reasoning_service.reason_about_action(
            context=payload.get("context", {}),
            task=payload.get("task"),
            history=payload.get("history", []),
        )

        # Send action back to extension
        action_message = MessageEnvelope(
            session_id=session_id,
            message_id=str(uuid4()),
            type="action",
            timestamp=datetime.utcnow(),
            payload={
                "action_type": action.action_type,
                "target_id": action.target_id,
                "value": action.value,
                "option": action.option,
                "direction": action.direction,
                "amount": action.amount,
                "duration_ms": action.duration_ms,
                "url": action.url,
                "confidence": action.confidence,
                "reason": action.reason,
            },
        )

        await send_message(websocket, action_message)
        logger.info(f"[Context Handler] Sent action to extension: {action.action_type}")

    except Exception as e:
        logger.error(f"[Context Handler] Error: {e}")
        error_msg = MessageEnvelope(
            session_id=session_id,
            message_id=str(uuid4()),
            type="error",
            timestamp=datetime.utcnow(),
            payload={
                "error_code": "REASONING_FAILED",
                "message": str(e),
            },
        )
        await send_message(websocket, error_msg)


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    client_id: str = Query(None)
):
    """
    WebSocket endpoint for extension connections

    Path: /ws
    Query params:
        client_id: Optional browser extension client identifier
    """
    session_id = None

    try:
        await websocket.accept()
        logger.info(f"WebSocket connection accepted from {websocket.client}")

        # Get app from scope
        app = websocket.scope["app"]

        # Create session
        session_id = session_manager.create_session()
        active_connections[session_id] = websocket
        heartbeat_state[session_id] = 0

        logger.info(f"Session created: {session_id} (client: {client_id})")

        # Send welcome message with session ID
        welcome = MessageEnvelope(
            protocol_version="1.0",
            session_id=session_id,
            message_id=str(uuid4()),
            type="heartbeat",
            timestamp=datetime.utcnow(),
            payload={
                "message": "Connected to Privacy Vision Agent Backend",
                "session_id": session_id,
                "server_timestamp": datetime.utcnow().isoformat(),
            },
        )
        await send_message(websocket, welcome)

        # Listen for messages from extension
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=300.0)

                # Parse incoming message
                try:
                    msg_data = json.loads(data)
                    incoming = MessageEnvelope(**msg_data)
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON from {session_id}: {e}")
                    error_msg = MessageEnvelope(
                        session_id=session_id,
                        message_id=str(uuid4()),
                        type="error",
                        timestamp=datetime.utcnow(),
                        payload={
                            "error_code": "INVALID_JSON",
                            "message": str(e),
                        },
                    )
                    await send_message(websocket, error_msg)
                    continue

                # Validate session
                if incoming.session_id != session_id:
                    logger.warning(
                        f"Session ID mismatch: {incoming.session_id} != {session_id}"
                    )
                    error_msg = MessageEnvelope(
                        session_id=session_id,
                        message_id=str(uuid4()),
                        type="error",
                        timestamp=datetime.utcnow(),
                        payload={
                            "error_code": "INVALID_SESSION",
                            "message": "Session ID mismatch",
                        },
                    )
                    await send_message(websocket, error_msg)
                    continue

                # Record message
                session_manager.record_message(session_id)
                logger.debug(f"Message from {session_id}: {incoming.type}")

                # Handle different message types
                if incoming.type == "context":
                    # Process DOM context for reasoning
                    await handle_context_message(
                        websocket, session_id, incoming, app
                    )
                else:
                    # Echo back for acknowledgment
                    echo = MessageEnvelope(
                        session_id=session_id,
                        message_id=str(uuid4()),
                        type="heartbeat",
                        timestamp=datetime.utcnow(),
                        payload={
                            "received_message_id": incoming.message_id,
                            "received_type": incoming.type,
                            "server_timestamp": datetime.utcnow().isoformat(),
                        },
                    )
                    await send_message(websocket, echo)

            except asyncio.TimeoutError:
                logger.warning(f"Session {session_id} timeout (no message for 5 min)")
                break

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error for {session_id}: {e}")
    finally:
        if session_id:
            if session_id in active_connections:
                del active_connections[session_id]
            if session_id in heartbeat_state:
                del heartbeat_state[session_id]
            session_manager.end_session(session_id)
            logger.info(f"Session {session_id} cleaned up")


@router.get("/sessions/stats")
async def get_session_stats():
    """Get current session statistics"""
    return {
        "stats": session_manager.get_stats(),
        "timestamp": datetime.utcnow().isoformat(),
        "active_connections": len(active_connections),
    }


@router.post("/actions/send-test")
async def send_test_action(session_id: str, action: dict):
    """Send a test action to a session (for development)"""
    if session_id not in active_connections:
        return {"error": f"Session {session_id} not connected"}

    # Validate action
    is_valid, error = action_validator.validate(action)
    if not is_valid:
        return {"error": error, "validation_failed": True}

    # Send action to extension
    websocket = active_connections[session_id]
    message = MessageEnvelope(
        session_id=session_id,
        message_id=str(uuid4()),
        type="action",
        timestamp=datetime.utcnow(),
        payload={"action": action},
    )

    try:
        await send_message(websocket, message)
        return {
            "success": True,
            "message": "Action sent to extension",
            "action": action,
        }
    except Exception as e:
        logger.error(f"Failed to send action: {e}")
        return {"error": str(e)}
