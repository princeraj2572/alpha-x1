"""
Action schema definitions for browser automation
"""

from pydantic import BaseModel, Field
from typing import Literal, Optional, Any
from enum import Enum


class ActionType(str, Enum):
    """Supported action types"""
    CLICK = "click"
    TYPE = "type"
    SCROLL = "scroll"
    SELECT = "select"
    NAVIGATE = "navigate"
    WAIT = "wait"
    FINISH = "finish"


class ClickAction(BaseModel):
    """Click on an element"""
    action: Literal["click"]
    target_id: str = Field(..., description="Element ID from DOM scan")
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    reason: Optional[str] = None


class TypeAction(BaseModel):
    """Type text into a field"""
    action: Literal["type"]
    target_id: str = Field(..., description="Input field ID")
    value: Optional[str] = None
    value_ref: Optional[str] = Field(None, description="Reference to local secret (e.g., LOCAL_SECRET:EMAIL)")
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    reason: Optional[str] = None


class ScrollAction(BaseModel):
    """Scroll the page"""
    action: Literal["scroll"]
    direction: Literal["up", "down", "left", "right"]
    amount: int = Field(default=300, ge=1, le=5000, description="Pixels to scroll")
    confidence: float = Field(default=0.95, ge=0.0, le=1.0)
    reason: Optional[str] = None


class SelectAction(BaseModel):
    """Select an option from a dropdown"""
    action: Literal["select"]
    target_id: str = Field(..., description="Select element ID")
    option: str = Field(..., description="Option value or text")
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    reason: Optional[str] = None


class NavigateAction(BaseModel):
    """Navigate to a URL"""
    action: Literal["navigate"]
    url: str = Field(..., description="Target URL (must be http/https)")
    confidence: float = Field(default=0.95, ge=0.0, le=1.0)
    reason: Optional[str] = None


class WaitAction(BaseModel):
    """Wait for a condition"""
    action: Literal["wait"]
    duration_ms: int = Field(default=1000, ge=100, le=10000, description="Milliseconds to wait")
    reason: Optional[str] = None


class FinishAction(BaseModel):
    """Mark task as complete"""
    action: Literal["finish"]
    success: bool = True
    message: Optional[str] = None
    reason: Optional[str] = None


# Union of all action types
Action = (
    ClickAction
    | TypeAction
    | ScrollAction
    | SelectAction
    | NavigateAction
    | WaitAction
    | FinishAction
)


class ActionRequest(BaseModel):
    """Action request from backend to extension"""
    version: str = "1.0"
    action_id: str = Field(..., description="Unique action identifier")
    action: Action = Field(..., discriminator="action")
    timestamp: str
    priority: int = Field(default=0, ge=-10, le=10)


class ActionResult(BaseModel):
    """Result of action execution"""
    action_id: str
    success: bool
    error: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)
    execution_time_ms: int = 0
