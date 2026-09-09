"""
Privacy Vision Agent — Backend / Agent Gateway

FastAPI application for:
- Session management
- WebSocket communication with extension
- Message routing
- Provider integration (future)
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from .api import health, websocket_handler, reasoning
from .services.reasoning import ReasoningService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown"""
    logger.info("Starting Privacy Vision Agent Backend")

    # Initialize reasoning service
    reasoning_service = ReasoningService()
    app.state.reasoning = reasoning_service

    # Validate provider connection
    provider_valid = await reasoning_service.validate_provider()
    if provider_valid:
        logger.info("Cloud reasoning provider is ready")
    else:
        logger.warning("Cloud reasoning provider validation failed")

    yield

    logger.info("Shutting down Privacy Vision Agent Backend")


# Create FastAPI app
app = FastAPI(
    title="Privacy Vision Agent Backend",
    description="On-device visual perception for privacy-preserving browser agents",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware (allow extension communication)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router)
app.include_router(websocket_handler.router)
app.include_router(reasoning.router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Privacy Vision Agent Backend",
        "version": "0.1.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "status": "/status",
            "websocket": "ws://localhost:8000/ws",
            "stats": "/sessions/stats",
        },
        "documentation": "/docs",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )
