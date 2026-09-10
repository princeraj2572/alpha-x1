"""
OpenAI Provider Implementation
Implements browser automation reasoning via OpenAI's GPT models
"""

import asyncio
import json
from typing import Optional
from pydantic import BaseModel
import httpx

from .base import BaseProvider, ReasoningRequest, ActionResponse


class OpenAIProvider(BaseProvider):
    """OpenAI GPT provider for browser automation reasoning"""

    def __init__(self, api_key: str, model: str = "gpt-4-turbo-preview"):
        """
        Initialize OpenAI provider

        Args:
            api_key: OpenAI API key
            model: Model name (default: gpt-4-turbo-preview)
        """
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.openai.com/v1"
        self.conversation_history: list[dict] = []

        # System prompt for browser automation
        self.system_prompt = """You are a browser automation agent. Your task is to help users complete tasks on web pages by analyzing the current page state and suggesting actions.

You will receive:
1. Page structure (DOM elements)
2. Visual elements (buttons, inputs, etc.)
3. Current task description

You must respond with a JSON action following this schema:
{
  "action_type": "click|type|scroll|select|navigate|wait|finish",
  "target_id": "element_id or null",
  "value": "for type/select actions",
  "reason": "explanation of why this action",
  "confidence": 0.0-1.0
}

Rules:
- Only suggest actions that are visible and interactable
- For type actions, provide clear text values
- For navigate, only suggest same-domain navigation
- For scroll, specify direction (up/down/left/right)
- Confidence should reflect how certain you are
- If task is complete, action_type should be "finish"

Always respond with valid JSON only, no additional text."""

    async def reason(self, request: ReasoningRequest) -> ActionResponse:
        """
        Reason about the current page state and suggest an action

        Args:
            request: The reasoning request with sanitized context

        Returns:
            ActionResponse with the suggested action
        """
        try:
            # Build context message
            context_message = self._build_context_message(request)

            # Add to conversation history
            self.conversation_history.append({"role": "user", "content": context_message})

            # Call OpenAI API
            response = await self._call_openai()

            # Parse response
            action = self._parse_response(response)

            # Add assistant response to history
            self.conversation_history.append({"role": "assistant", "content": response})

            return action

        except Exception as e:
            return ActionResponse(
                action_id=f"openai-error-{request.session_id}",
                action_type="wait",
                target_id=None,
                confidence=0.0,
                reason=f"Error: {str(e)}",
                error=str(e),
            )

    def _build_context_message(self, request: ReasoningRequest) -> str:
        """Build the context message for OpenAI"""
        elements_text = "\n".join(
            [
                f"- {el.get('type', 'unknown')}: {el.get('text', el.get('label', 'unlabeled'))} (id: {el.get('id')})"
                for el in request.context.get("elements", [])[:20]  # Limit to 20 elements
            ]
        )

        return f"""Current Task: {request.task}

Page Title: {request.context.get('page', {}).get('title', 'Unknown')}

Available Elements:
{elements_text}

Visual Elements Detected:
- Buttons: {request.context.get('stats', {}).get('buttons', 0)}
- Inputs: {request.context.get('stats', {}).get('inputs', 0)}
- Links: {request.context.get('stats', {}).get('links', 0)}

What action should be taken next?"""

    async def _call_openai(self) -> str:
        """Call OpenAI API with conversation history"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                *self.conversation_history,
            ],
            "temperature": 0.7,
            "max_tokens": 500,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()

            data = response.json()
            return data["choices"][0]["message"]["content"]

    def _parse_response(self, response_text: str) -> ActionResponse:
        """Parse OpenAI response into ActionResponse"""
        try:
            # Try to extract JSON from response
            # OpenAI might include markdown code blocks
            if "```json" in response_text:
                json_str = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                json_str = response_text.split("```")[1].split("```")[0].strip()
            else:
                json_str = response_text

            action_data = json.loads(json_str)

            return ActionResponse(
                action_id=f"openai-{asyncio.get_event_loop().time()}",
                action_type=action_data.get("action_type", "wait"),
                target_id=action_data.get("target_id"),
                value=action_data.get("value"),
                confidence=float(action_data.get("confidence", 0.5)),
                reason=action_data.get("reason", "No reason provided"),
                metadata={
                    "model": self.model,
                    "conversation_turns": len(self.conversation_history),
                },
            )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            # If parsing fails, return a wait action
            return ActionResponse(
                action_id=f"openai-parse-error-{asyncio.get_event_loop().time()}",
                action_type="wait",
                target_id=None,
                confidence=0.0,
                reason=f"Failed to parse response: {str(e)}",
                error=f"Parse error: {str(e)}",
            )

    def reset_conversation(self):
        """Reset conversation history for a new task"""
        self.conversation_history = []

    def get_conversation_length(self) -> int:
        """Get current conversation history length"""
        return len(self.conversation_history)
