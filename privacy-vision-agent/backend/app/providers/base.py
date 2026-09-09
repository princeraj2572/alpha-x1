"""
Provider abstraction for cloud AI models
"""

from abc import ABC, abstractmethod
from pydantic import BaseModel


class ReasoningRequest(BaseModel):
    """Request to cloud model for reasoning"""
    context: dict  # DOM structure, page info, etc.
    task: str | None = None  # User's task/intent
    history: list[dict] | None = None  # Previous actions/results


class ActionResponse(BaseModel):
    """Response from cloud model"""
    action_type: str
    target_id: str | None = None
    value: str | None = None
    option: str | None = None
    direction: str | None = None
    amount: int | None = None
    duration_ms: int | None = None
    url: str | None = None
    confidence: float = 0.9
    reason: str | None = None


class BaseProvider(ABC):
    """Base class for cloud reasoning providers"""

    @abstractmethod
    async def reason(self, request: ReasoningRequest) -> ActionResponse:
        """Send context to cloud model and get action"""
        pass

    @abstractmethod
    async def validate_connection(self) -> bool:
        """Check if provider is available"""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name"""
        pass
