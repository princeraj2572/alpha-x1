"""
Ollama provider for cloud reasoning

Talks to a local (or remote) Ollama server (https://ollama.com) over its
native REST API. Unlike the Claude/OpenAI providers, this one actually sends
the sanitized screenshot to the model — Ollama's vision models (llava,
llama3.2-vision, qwen2.5vl, ...) accept images directly on the chat message,
so the model interprets the redacted screenshot rather than DOM text alone.
"""

import base64
import json
import logging
import re

import httpx

from .base import BaseProvider, ReasoningRequest, ActionResponse

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a browser automation agent. You are shown a sanitized \
screenshot of the current page (faces blurred, sensitive text blacked out) plus its \
DOM structure, and must decide the single next action to move the user's task forward.

Respond with EXACTLY ONE action as a JSON object, no markdown, no commentary:

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
- Set unused fields to null
- confidence must be 0.0-1.0
- For click: must have target_id
- For type: must have target_id and value
- For navigate: must have valid http/https URL
- For wait: must have duration_ms (100-10000ms)
- For scroll: must have direction and amount
- For select: must have target_id and option
- For finish: indicate task completion"""


def _strip_data_url(data_url: str) -> str:
    """Ollama's `images` field wants raw base64 — no `data:image/...;base64,` prefix."""
    if data_url.startswith("data:"):
        return data_url.split(",", 1)[-1]
    return data_url


class OllamaProvider(BaseProvider):
    """Ollama-served open-weights VLM provider for browser agent reasoning."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llava"):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.conversation_history: list[dict] = []

    async def reason(self, request: ReasoningRequest) -> ActionResponse:
        try:
            text = self._build_context_summary(request)
            image_b64 = self._extract_image(request)

            user_message: dict = {"role": "user", "content": text}
            if image_b64:
                user_message["images"] = [image_b64]

            self.conversation_history.append(user_message)

            logger.info(
                f"[Ollama Provider] Sending reasoning request to {self.model}"
                f" ({'with' if image_b64 else 'without'} image)"
            )

            assistant_message = await self._call_ollama()

            self.conversation_history.append({"role": "assistant", "content": assistant_message})

            logger.debug(f"[Ollama Provider] Response: {assistant_message}")

            action = self._parse_action(assistant_message)
            logger.info(f"[Ollama Provider] Action generated: {action.action_type}")
            return action

        except httpx.ConnectError as e:
            logger.error(f"[Ollama Provider] Could not reach Ollama at {self.base_url}: {e}")
            return ActionResponse(
                action_type="wait",
                duration_ms=2000,
                reason=f"Ollama server unreachable at {self.base_url}",
                confidence=0.0,
            )
        except Exception as e:
            logger.error(f"[Ollama Provider] Error: {e}")
            raise

    async def validate_connection(self) -> bool:
        """Check the Ollama server is reachable and warn (but don't fail) if the
        configured model hasn't been pulled yet — that's the #1 real-world gotcha."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()

            installed = {m.get("name", "").split(":")[0] for m in data.get("models", [])}
            if self.model.split(":")[0] not in installed:
                logger.warning(
                    f"[Ollama Provider] Server reachable but model '{self.model}' isn't "
                    f"pulled yet — run `ollama pull {self.model}`. Installed: {sorted(installed)}"
                )

            logger.info("[Ollama Provider] Connection validated")
            return True
        except Exception as e:
            logger.error(f"[Ollama Provider] Connection failed: {e}")
            return False

    @property
    def name(self) -> str:
        return f"ollama ({self.model})"

    def _extract_image(self, request: ReasoningRequest) -> str | None:
        raw = request.context.get("sanitizedScreenshot")
        if not raw or not isinstance(raw, str):
            return None
        return _strip_data_url(raw)

    def _build_context_summary(self, request: ReasoningRequest) -> str:
        """Build human-readable context to go alongside the image."""
        lines = []

        if "url" in request.context:
            lines.append(f"Page: {request.context['url']}")
        if "title" in request.context:
            lines.append(f"Title: {request.context['title']}")

        if request.task:
            lines.append(f"\nTask: {request.task}")

        if request.context.get("sanitizedScreenshot"):
            lines.append(
                "\nA sanitized screenshot of the page is attached — faces are blurred "
                "and sensitive text is blacked out. Use it to understand layout and "
                "find the element described below."
            )

        elements = request.context.get("elements")
        if elements:
            lines.append(f"\nAvailable elements ({len(elements)}):")
            for elem in elements[:20]:
                elem_str = f"  - {elem.get('type', 'unknown')}"
                if elem.get("id"):
                    elem_str += f" (id: {elem['id']})"
                if elem.get("label"):
                    elem_str += f" [{elem['label']}]"
                if elem.get("text"):
                    elem_str += f" \"{elem['text'][:50]}\""
                lines.append(elem_str)

        if request.history:
            lines.append(f"\nPrevious actions ({len(request.history)}):")
            for action in request.history[-5:]:
                status = "✓" if action.get("success") else "✗"
                lines.append(f"  {status} {action.get('action_type', '?')}: {action.get('reason', '')}")

        return "\n".join(lines)

    async def _call_ollama(self) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                *self.conversation_history,
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.2},
        }

        # Local vision inference can be slow without a GPU — generous timeout.
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{self.base_url}/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]

    def _parse_action(self, response_text: str) -> ActionResponse:
        try:
            json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
            if not json_match:
                logger.warning(f"[Ollama Provider] No JSON found in response: {response_text}")
                return ActionResponse(
                    action_type="wait",
                    duration_ms=1000,
                    reason="Parsing error, waiting for retry",
                    confidence=0.5,
                )

            action_data = json.loads(json_match.group())
            if "action" in action_data:
                action_data["action_type"] = action_data.pop("action")

            return ActionResponse(**action_data)

        except json.JSONDecodeError as e:
            logger.error(f"[Ollama Provider] JSON parse error: {e}")
            return ActionResponse(
                action_type="wait",
                duration_ms=1000,
                reason="JSON parse error",
                confidence=0.0,
            )
        except Exception as e:
            logger.error(f"[Ollama Provider] Validation error: {e}")
            return ActionResponse(
                action_type="wait",
                duration_ms=1000,
                reason="Validation error",
                confidence=0.0,
            )
