"""
Action validation and policy enforcement
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class ActionValidator:
    """Validates actions before sending to extension"""

    RISKY_ACTIONS = {"navigate"}
    ALLOWED_URL_SCHEMES = {"http", "https"}

    def __init__(self):
        self.total_validated = 0
        self.total_rejected = 0

    def validate(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate an action. Returns: (is_valid, error_message)"""
        try:
            if "action" not in action:
                return False, "Action missing 'action' field"

            action_type = action.get("action")

            # Type-specific validation
            if action_type == "click":
                return self._validate_click(action)
            elif action_type == "type":
                return self._validate_type(action)
            elif action_type == "scroll":
                return self._validate_scroll(action)
            elif action_type == "select":
                return self._validate_select(action)
            elif action_type == "navigate":
                return self._validate_navigate(action)
            elif action_type == "wait":
                return self._validate_wait(action)
            elif action_type == "finish":
                return self._validate_finish(action)
            else:
                return False, f"Unknown action type: {action_type}"

        except Exception as e:
            logger.error(f"Validation error: {e}")
            return False, f"Validation error: {str(e)}"

    def _validate_click(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate click action"""
        if "target_id" not in action or not action["target_id"]:
            return False, "Click requires target_id"
        self.total_validated += 1
        return True, None

    def _validate_type(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate type action"""
        if "target_id" not in action or not action["target_id"]:
            return False, "Type requires target_id"

        has_value = "value" in action and action["value"] is not None
        has_ref = "value_ref" in action and action["value_ref"] is not None

        if not (has_value or has_ref):
            return False, "Type requires either 'value' or 'value_ref'"

        if has_value and has_ref:
            return False, "Type cannot have both 'value' and 'value_ref'"

        if has_ref and not str(action["value_ref"]).startswith("LOCAL_SECRET:"):
            return False, "value_ref must start with 'LOCAL_SECRET:'"

        self.total_validated += 1
        return True, None

    def _validate_scroll(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate scroll action"""
        if "direction" not in action:
            return False, "Scroll requires direction"

        if action["direction"] not in {"up", "down", "left", "right"}:
            return False, f"Invalid scroll direction: {action['direction']}"

        self.total_validated += 1
        return True, None

    def _validate_select(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate select action"""
        if "target_id" not in action or not action["target_id"]:
            return False, "Select requires target_id"

        if "option" not in action or not action["option"]:
            return False, "Select requires option value"

        self.total_validated += 1
        return True, None

    def _validate_navigate(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate navigate action"""
        if "url" not in action or not action["url"]:
            return False, "Navigate requires url"

        url = str(action["url"]).strip()

        scheme = url.split("://")[0].lower() if "://" in url else ""
        if scheme not in self.ALLOWED_URL_SCHEMES:
            return False, f"URL scheme not allowed: {scheme}"

        if url.lower().startswith(("javascript:", "data:", "file:")):
            return False, "Dangerous URL scheme blocked"

        logger.warning(f"Risky action approved: NAVIGATE to {url}")
        self.total_validated += 1
        return True, None

    def _validate_wait(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate wait action"""
        if "duration_ms" in action:
            if not (100 <= action["duration_ms"] <= 10000):
                return False, "Wait duration must be between 100ms and 10000ms"

        self.total_validated += 1
        return True, None

    def _validate_finish(self, action: dict) -> tuple[bool, Optional[str]]:
        """Validate finish action"""
        self.total_validated += 1
        return True, None

    def get_stats(self) -> dict:
        """Get validation statistics"""
        total = self.total_validated + self.total_rejected
        return {
            "total_validated": self.total_validated,
            "total_rejected": self.total_rejected,
            "acceptance_rate": self.total_validated / total if total > 0 else 0.0,
        }
