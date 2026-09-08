"""
Message protocol schemas for extension ↔ backend communication
"""

from pydantic import BaseModel, Field
from typing import Any, Literal
from datetime import datetime


class MessageEnvelope(BaseModel):
    """Standard message envelope for all communications"""

    protocol_version: str = "1.0"
    session_id: str
    message_id: str
    type: Literal["context", "action", "action_result", "error", "heartbeat", "page_changed"]
    timestamp: datetime
    payload: dict[str, Any] = Field(default_factory=dict)

    class Config:
        json_schema_extra = {
            "example": {
                "protocol_version": "1.0",
                "session_id": "uuid-here",
                "message_id": "uuid-here",
                "type": "heartbeat",
                "timestamp": "2026-09-09T12:00:00Z",
                "payload": {}
            }
        }


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    version: str = "0.1.0"


class SessionResponse(BaseModel):
    """Session creation response"""
    session_id: str
    status: str = "active"
    created_at: datetime


class HeartbeatPayload(BaseModel):
    """Heartbeat message payload"""
    sequence: int
    server_timestamp: datetime


class ErrorPayload(BaseModel):
    """Error message payload"""
    error_code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
