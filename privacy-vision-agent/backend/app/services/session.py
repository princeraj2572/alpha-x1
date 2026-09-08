"""
Session management for extension connections
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass, field


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

    @property
    def age_seconds(self) -> float:
        """Session age in seconds"""
        return (datetime.utcnow() - self.created_at).total_seconds()

    @property
    def is_stale(self, timeout_seconds: int = 300) -> bool:
        """Check if session has no recent heartbeat (5 min default)"""
        return (datetime.utcnow() - self.last_heartbeat).total_seconds() > timeout_seconds


class SessionManager:
    """Manages active sessions for connected extensions"""

    def __init__(self, timeout_seconds: int = 300):
        self.sessions: dict[str, SessionData] = {}
        self.timeout_seconds = timeout_seconds

    def create_session(self) -> str:
        """Create a new session"""
        session_id = str(uuid.uuid4())
        now = datetime.utcnow()
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
        session.last_heartbeat = datetime.utcnow()
        session.heartbeat_count += 1
        return True

    def record_message(self, session_id: str) -> bool:
        """Record message received for a session"""
        session = self.get_session(session_id)
        if not session:
            return False
        session.message_count += 1
        session.last_heartbeat = datetime.utcnow()  # Reset on activity
        return True

    def end_session(self, session_id: str) -> bool:
        """End a session"""
        session = self.get_session(session_id)
        if not session:
            return False
        session.is_active = False
        return True

    def cleanup_stale_sessions(self) -> list[str]:
        """Remove sessions with no recent heartbeat"""
        now = datetime.utcnow()
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
