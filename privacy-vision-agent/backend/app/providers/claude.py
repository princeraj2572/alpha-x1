"""
Claude provider for cloud reasoning
"""

import json
import logging
from anthropic import Anthropic, APIError
from pydantic import ValidationError

from .base import BaseProvider, ReasoningRequest, ActionResponse

logger = logging.getLogger(__name__)


class ClaudeProvider(BaseProvider):
    """Claude API provider for browser agent reasoning"""

    def __init__(self, api_key: str | None = None):
        """Initialize Claude provider"""
        self.client = Anthropic(api_key=api_key)
        self.model = "claude-opus-5"
        self.conversation_history: list[dict] = []

    async def reason(self, request: ReasoningRequest) -> ActionResponse:
        """Use Claude to reason about next action"""
        try:
            # Build context message
            context_summary = self._build_context_summary(request)

            # Add to conversation history
            self.conversation_history.append({
                "role": "user",
                "content": context_summary,
            })

            # Call Claude
            logger.info(f"[Claude Provider] Sending reasoning request to {self.model}")

            response = self.client.messages.create(
                model=self.model,
                max_tokens=500,
                system=self._get_system_prompt(),
                messages=self.conversation_history,
            )

            # Extract action from response
            assistant_message = response.content[0].text

            # Add assistant response to history
            self.conversation_history.append({
                "role": "assistant",
                "content": assistant_message,
            })

            logger.debug(f"[Claude Provider] Response: {assistant_message}")

            # Parse action from response
            action = self._parse_action(assistant_message)

            logger.info(f"[Claude Provider] Action generated: {action.action_type}")

            return action

        except APIError as e:
            logger.error(f"[Claude Provider] API error: {e}")
            raise
        except Exception as e:
            logger.error(f"[Claude Provider] Error: {e}")
            raise

    async def validate_connection(self) -> bool:
        """Test Claude connection"""
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Hi"}],
            )
            logger.info("[Claude Provider] Connection validated")
            return True
        except Exception as e:
            logger.error(f"[Claude Provider] Connection failed: {e}")
            return False

    @property
    def name(self) -> str:
        """Provider name"""
        return f"claude ({self.model})"

    def _get_system_prompt(self) -> str:
        """System prompt for Claude"""
        return """You are a browser automation agent. Your job is to help users complete web tasks by analyzing the current page and suggesting the next action.

You have access to:
- Current page URL
- DOM structure (element types, IDs, labels)
- Screenshot metadata (visual layout)
- Previous actions taken

You must respond with EXACTLY ONE action in JSON format:

{
  "action": "click|type|scroll|select|navigate|wait|finish",
  "target_id": "element-id-or-null",
  "value": "text-for-type-action-or-null",
  "option": "dropdown-value-or-null",
  "direction": "up|down|left|right-or-null",
  "amount": 300,
  "duration_ms": 1000,
  "url": "https://example.com-or-null",
  "confidence": 0.95,
  "reason": "brief explanation of why this action"
}

Rules:
- Only one action per response
- Use JSON format only, no markdown
- Set unused fields to null
- confidence must be 0.0-1.0
- For click: must have target_id
- For type: must have target_id and value
- For navigate: must have valid http/https URL
- For wait: must have duration_ms (100-10000ms)
- For scroll: must have direction and amount
- For select: must have target_id and option
- For finish: indicate task completion"""

    def _build_context_summary(self, request: ReasoningRequest) -> str:
        """Build human-readable context for Claude"""
        lines = []

        # Page info
        if "url" in request.context:
            lines.append(f"Page: {request.context['url']}")

        if "title" in request.context:
            lines.append(f"Title: {request.context['title']}")

        # Task
        if request.task:
            lines.append(f"\nTask: {request.task}")

        # DOM structure
        if "elements" in request.context:
            lines.append(f"\nAvailable elements ({len(request.context['elements'])}):")
            for elem in request.context["elements"][:20]:  # Limit to first 20
                elem_str = f"  - {elem.get('type', 'unknown')}"
                if elem.get("id"):
                    elem_str += f" (id: {elem['id']})"
                if elem.get("label"):
                    elem_str += f" [{elem['label']}]"
                if elem.get("text"):
                    text = elem["text"][:50]
                    elem_str += f" \"{text}\""
                lines.append(elem_str)

        # Previous actions
        if request.history:
            lines.append(f"\nPrevious actions ({len(request.history)}):")
            for action in request.history[-5:]:  # Last 5
                status = "✓" if action.get("success") else "✗"
                lines.append(f"  {status} {action.get('action_type', '?')}: {action.get('reason', '')}")

        return "\n".join(lines)

    def _parse_action(self, response_text: str) -> ActionResponse:
        """Parse JSON action from Claude response"""
        try:
            # Extract JSON from response
            import re
            json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
            if not json_match:
                logger.warning(f"[Claude Provider] No JSON found in response: {response_text}")
                # Default to wait action if parsing fails
                return ActionResponse(
                    action_type="wait",
                    duration_ms=1000,
                    reason="Parsing error, waiting for retry",
                    confidence=0.5,
                )

            json_str = json_match.group()
            action_data = json.loads(json_str)

            # Map "action" key to "action_type"
            if "action" in action_data:
                action_data["action_type"] = action_data.pop("action")

            return ActionResponse(**action_data)

        except json.JSONDecodeError as e:
            logger.error(f"[Claude Provider] JSON parse error: {e}")
            return ActionResponse(
                action_type="wait",
                duration_ms=1000,
                reason="JSON parse error",
                confidence=0.0,
            )
        except ValidationError as e:
            logger.error(f"[Claude Provider] Validation error: {e}")
            return ActionResponse(
                action_type="wait",
                duration_ms=1000,
                reason="Validation error",
                confidence=0.0,
            )
