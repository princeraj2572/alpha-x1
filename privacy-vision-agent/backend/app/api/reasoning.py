"""
Cloud reasoning API endpoints
"""

import logging
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(tags=["reasoning"])


class ReasoningRequest(BaseModel):
    """Request for cloud reasoning"""
    session_id: str
    context: dict  # DOM structure from extension
    task: str | None = None
    history: list[dict] | None = None


@router.post("/reason")
async def reason_about_action(request: ReasoningRequest, http_request: Request):
    """
    Send page context to cloud model and get next action

    Path: /reason
    Body: ReasoningRequest (context, task, history)
    Returns: ActionResponse
    """
    try:
        reasoning_service = http_request.app.state.reasoning

        logger.info(f"[Reasoning API] Request from session {request.session_id}")

        action = await reasoning_service.reason_about_action(
            context=request.context,
            task=request.task,
            history=request.history,
        )

        logger.info(f"[Reasoning API] Generated action: {action.action_type}")

        return {
            "success": True,
            "action": action.model_dump(),
            "session_id": request.session_id,
        }

    except Exception as e:
        logger.error(f"[Reasoning API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reasoning/stats")
async def get_reasoning_stats(http_request: Request):
    """Get reasoning service statistics"""
    reasoning_service = http_request.app.state.reasoning
    return {
        "stats": reasoning_service.get_stats(),
    }
