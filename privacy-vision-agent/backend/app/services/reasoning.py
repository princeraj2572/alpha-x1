"""
Reasoning service that coordinates with cloud providers
"""

import logging
import os
from typing import Optional

from ..providers import BaseProvider, ReasoningRequest, ActionResponse, ClaudeProvider
from ..providers.openai import OpenAIProvider
from ..providers.ollama import OllamaProvider

logger = logging.getLogger(__name__)


class ReasoningService:
    """Manages cloud reasoning for browser automation"""

    def __init__(self, provider: Optional[BaseProvider] = None):
        """Initialize reasoning service"""
        self.provider = provider
        self.request_count = 0
        self.error_count = 0

    def _get_provider(self) -> BaseProvider:
        """Lazy-load provider on first use"""
        if self.provider is None:
            provider_name = os.getenv("AI_PROVIDER", "anthropic").lower()

            if provider_name == "openai":
                api_key = os.getenv("OPENAI_API_KEY")
                if not api_key:
                    raise ValueError("OPENAI_API_KEY environment variable not set")
                model = os.getenv("OPENAI_MODEL", "gpt-4-turbo-preview")
                self.provider = OpenAIProvider(api_key=api_key, model=model)
                logger.info("[Reasoning Service] Using OpenAI provider")
            elif provider_name == "ollama":
                base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
                model = os.getenv("OLLAMA_MODEL", "llava")
                self.provider = OllamaProvider(base_url=base_url, model=model)
                logger.info(f"[Reasoning Service] Using Ollama provider ({model} @ {base_url})")
            else:
                # Default to Claude
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if api_key:
                    self.provider = ClaudeProvider(api_key=api_key)
                else:
                    self.provider = ClaudeProvider()
                logger.info("[Reasoning Service] Using Claude provider")

        return self.provider

    async def reason_about_action(
        self,
        context: dict,
        task: Optional[str] = None,
        history: Optional[list[dict]] = None,
    ) -> ActionResponse:
        """Get next action from cloud model"""
        try:
            self.request_count += 1
            provider = self._get_provider()

            logger.info(
                f"[Reasoning Service] Request #{self.request_count} to {provider.name}"
            )

            request = ReasoningRequest(
                context=context,
                task=task,
                history=history or [],
            )

            action = await provider.reason(request)

            logger.info(f"[Reasoning Service] Action: {action.action_type}")

            return action

        except Exception as e:
            self.error_count += 1
            logger.error(f"[Reasoning Service] Reasoning failed: {e}")
            raise

    async def validate_provider(self) -> bool:
        """Check if provider is available"""
        try:
            provider = self._get_provider()
            is_valid = await provider.validate_connection()
            if is_valid:
                logger.info(f"[Reasoning Service] Provider {provider.name} is available")
            else:
                logger.warning(f"[Reasoning Service] Provider {provider.name} is not available")
            return is_valid
        except Exception as e:
            logger.error(f"[Reasoning Service] Provider validation failed: {e}")
            return False

    def get_stats(self) -> dict:
        """Get reasoning service statistics"""
        provider_name = self._get_provider().name if self.provider else "not-initialized"
        return {
            "provider": provider_name,
            "requests": self.request_count,
            "errors": self.error_count,
            "error_rate": (
                self.error_count / self.request_count if self.request_count > 0 else 0
            ),
        }
