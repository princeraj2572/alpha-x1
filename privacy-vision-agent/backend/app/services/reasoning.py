"""
Reasoning service that coordinates with cloud providers
"""

import logging
from typing import Optional

from ..providers import BaseProvider, ReasoningRequest, ActionResponse, ClaudeProvider

logger = logging.getLogger(__name__)


class ReasoningService:
    """Manages cloud reasoning for browser automation"""

    def __init__(self, provider: Optional[BaseProvider] = None):
        """Initialize reasoning service"""
        self.provider = provider or ClaudeProvider()
        self.request_count = 0
        self.error_count = 0

    async def reason_about_action(
        self,
        context: dict,
        task: Optional[str] = None,
        history: Optional[list[dict]] = None,
    ) -> ActionResponse:
        """Get next action from cloud model"""
        try:
            self.request_count += 1

            logger.info(
                f"[Reasoning Service] Request #{self.request_count} to {self.provider.name}"
            )

            request = ReasoningRequest(
                context=context,
                task=task,
                history=history or [],
            )

            action = await self.provider.reason(request)

            logger.info(f"[Reasoning Service] Action: {action.action_type}")

            return action

        except Exception as e:
            self.error_count += 1
            logger.error(f"[Reasoning Service] Reasoning failed: {e}")
            raise

    async def validate_provider(self) -> bool:
        """Check if provider is available"""
        try:
            is_valid = await self.provider.validate_connection()
            if is_valid:
                logger.info(f"[Reasoning Service] Provider {self.provider.name} is available")
            else:
                logger.warning(f"[Reasoning Service] Provider {self.provider.name} is not available")
            return is_valid
        except Exception as e:
            logger.error(f"[Reasoning Service] Provider validation failed: {e}")
            return False

    def get_stats(self) -> dict:
        """Get reasoning service statistics"""
        return {
            "provider": self.provider.name,
            "requests": self.request_count,
            "errors": self.error_count,
            "error_rate": (
                self.error_count / self.request_count if self.request_count > 0 else 0
            ),
        }
