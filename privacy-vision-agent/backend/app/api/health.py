"""
Health check endpoint
"""

from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from ..schemas.messages import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint

    Returns:
        HealthResponse: Server status
    """
    return HealthResponse(
        status="ok",
        version="0.1.0",
    )


@router.get("/status")
async def status():
    """Extended status information"""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "Privacy Vision Agent Backend",
        "version": "0.1.0",
        "features": [
            "WebSocket communication",
            "Session management",
            "Message routing",
        ],
    }
