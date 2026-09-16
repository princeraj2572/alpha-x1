"""
Session management for extension connections
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from dataclasses import dataclass, field

# Bound on how many past action results a session remembers — enough for the
# model to see recent context without the history payload growing unbounded
# over a long-running session.
MAX_ACTION_HISTORY = 20

# Consecutive action failures before we tell the extension the agent looks
# stuck, rather than silently letting it keep retrying the same thing.
CONSECUTIVE_FAILURE_WARNING_THRESHOLD = 3


@dataclass
class SessionData:
    """Active session information"""
    session_id: str
    created_at: datetime
    last_heartbeat: datetime
    heartbeat_count: int = 0
    message_count: int = 0
    is_active: bool = True
    metadata: dict = field(default_factory=dict)
    # Action loop state (DECISION-014): what got sent, what the extension
    # reported back, and a running tally of consecutive failures.
    action_history: list[dict] = field(default_factory=list)
    consecutive_failures: int = 0
    pending_actions: dict[str, dict] = field(default_factory=dict)

    @property
    def age_seconds(self) -> float:
        """Session age in seconds"""
        return (datetime.now(timezone.utc) - self.created_at).total_seconds()

    @property
    def is_stale(self, timeout_seconds: int = 300) -> bool:
        """Check if session has no recent heartbeat (5 min default)"""
        return (datetime.now(timezone.utc) - self.last_heartbeat).total_seconds() > timeout_seconds


class SessionManager:
    """Manages active sessions for connected extensions"""

    def __init__(self, timeout_seconds: int = 300):
        self.sessions: dict[str, SessionData] = {}
        self.timeout_seconds = timeout_seconds

    def create_session(self) -> str:
        """Create a new session"""
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        self.sessions[session_id] = SessionData(
            session_id=session_id,
            created_at=now,
            last_heartbeat=now,
        )
        return session_id

    def get_session(self, session_id: str) -> Optional[SessionData]:
        """Get session by ID"""
        return self.sessions.get(session_id)

    def is_valid_session(self, session_id: str) -> bool:
        """Check if session exists and is active"""
        session = self.get_session(session_id)
        if not session:
            return False
        return session.is_active

    def record_heartbeat(self, session_id: str) -> bool:
        """Record heartbeat for a session"""
        session = self.get_session(session_id)
        if not session:
            return False
        session.last_heartbeat = datetime.now(timezone.utc)
        session.heartbeat_count += 1
        return True

    def record_message(self, session_id: str) -> bool:
        """Record message received for a session"""
        session = self.get_session(session_id)
        if not session:
            return False
        session.message_count += 1
        session.last_heartbeat = datetime.now(timezone.utc)  # Reset on activity
        return True

    def record_sent_action(self, session_id: str, message_id: str, action: dict) -> None:
        """Remember what was sent for `message_id` so a later `action_result`
        (which carries only success/error, not the action itself) can be
        joined back into a complete history entry."""
        session = self.get_session(session_id)
        if session:
            session.pending_actions[message_id] = action

    def record_action_result(
        self, session_id: str, message_id: Optional[str], result: dict
    ) -> Optional[SessionData]:
        """Record an `action_result` payload from the extension. Joins it
        back to the action `record_sent_action` stored under the same
        `message_id`, if any, so the history entry carries what was
        attempted, not just whether it succeeded. Returns the session (so
        callers can inspect `consecutive_failures`), or None if the session
        doesn't exist."""
        session = self.get_session(session_id)
        if not session:
            return None

        success = bool(result.get("success"))
        sent_action = session.pending_actions.pop(message_id, {}) if message_id else {}

        entry = {
            "action_type": sent_action.get("action_type"),
            "target_id": sent_action.get("target_id"),
            "reason": sent_action.get("reason"),
            "success": success,
            "error": result.get("error"),
        }
        session.action_history.append(entry)
        if len(session.action_history) > MAX_ACTION_HISTORY:
            session.action_history = session.action_history[-MAX_ACTION_HISTORY:]

        session.consecutive_failures = 0 if success else session.consecutive_failures + 1
        return session

    def get_action_history(self, session_id: str) -> list[dict]:
        """Server-tracked action history for a session, oldest first."""
        session = self.get_session(session_id)
        return list(session.action_history) if session else []

    def end_session(self, session_id: str) -> bool:
        """End a session"""
        session = self.get_session(session_id)
        if not session:
            return False
        session.is_active = False
        return True

    def cleanup_stale_sessions(self) -> list[str]:
        """Remove sessions with no recent heartbeat"""
        now = datetime.now(timezone.utc)
        stale = []
        for session_id, session in list(self.sessions.items()):
            age = (now - session.last_heartbeat).total_seconds()
            if age > self.timeout_seconds:
                stale.append(session_id)
                del self.sessions[session_id]
        return stale

    def get_active_sessions(self) -> list[SessionData]:
        """Get all active sessions"""
        return [s for s in self.sessions.values() if s.is_active]

    def get_stats(self) -> dict:
        """Get session statistics"""
        active = self.get_active_sessions()
        return {
            "total_sessions": len(self.sessions),
            "active_sessions": len(active),
            "total_heartbeats": sum(s.heartbeat_count for s in active),
            "total_messages": sum(s.message_count for s in active),
        }
