"""
Privacy detection and redaction engine
Identifies sensitive data and prevents transmission
"""

import re
import logging
from enum import Enum
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class SensitivityLevel(str, Enum):
    """Data sensitivity classification"""
    PUBLIC = "public"
    INTERNAL = "internal"
    SENSITIVE = "sensitive"
    CONFIDENTIAL = "confidential"


@dataclass
class RedactionResult:
    """Result of privacy detection"""
    is_sensitive: bool
    sensitivity_level: SensitivityLevel
    reason: str
    redacted_value: str | None = None


class PrivacyDetector:
    """Detects and redacts sensitive data"""

    # Regex patterns for common PII
    PATTERNS = {
        "email": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
        "phone": re.compile(r"\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b"),
        "ssn": re.compile(r"\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"),
        "credit_card": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
        "us_passport": re.compile(r"\b[0-9]{9}\b"),
        "ip_address": re.compile(r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b"),
    }

    # Field names that indicate sensitive content
    SENSITIVE_FIELD_NAMES = {
        "password", "passwd", "pwd", "secret", "pin",
        "credit_card", "card_number", "cvv", "cvc", "ssn",
        "social_security", "passport", "license", "drivers_license",
        "private_key", "api_key", "token", "session",
        "auth", "login", "email_password",
    }

    # HTML input types that indicate sensitive content
    SENSITIVE_INPUT_TYPES = {
        "password",
        "email",
        "tel",
        "hidden",
    }

    def __init__(self):
        """Initialize privacy detector"""
        self.detections_count = 0
        self.redactions_count = 0

    def detect_pii(self, text: str | None) -> RedactionResult:
        """Detect if text contains PII"""
        if not text:
            return RedactionResult(False, SensitivityLevel.PUBLIC, "Empty value")

        text_str = str(text).strip()

        # Check each pattern
        for pattern_name, pattern in self.PATTERNS.items():
            if pattern.search(text_str):
                self.detections_count += 1
                self.redactions_count += 1
                logger.debug(f"[Privacy] Detected {pattern_name}: {text_str[:20]}...")
                return RedactionResult(
                    is_sensitive=True,
                    sensitivity_level=SensitivityLevel.CONFIDENTIAL,
                    reason=f"Detected {pattern_name}",
                    redacted_value=f"[{pattern_name.upper()}]"
                )

        return RedactionResult(False, SensitivityLevel.PUBLIC, "No PII detected")

    def check_field_sensitivity(
        self,
        field_name: str | None,
        input_type: str | None,
        aria_label: str | None
    ) -> SensitivityLevel:
        """Determine sensitivity based on field metadata"""
        if not field_name and not input_type and not aria_label:
            return SensitivityLevel.PUBLIC

        # Check field name
        if field_name:
            field_lower = field_name.lower()
            for sensitive_term in self.SENSITIVE_FIELD_NAMES:
                if sensitive_term in field_lower:
                    return SensitivityLevel.CONFIDENTIAL

        # Check input type
        if input_type and input_type.lower() in self.SENSITIVE_INPUT_TYPES:
            return SensitivityLevel.CONFIDENTIAL

        # Check aria-label
        if aria_label:
            label_lower = aria_label.lower()
            for sensitive_term in self.SENSITIVE_FIELD_NAMES:
                if sensitive_term in label_lower:
                    return SensitivityLevel.CONFIDENTIAL

        return SensitivityLevel.INTERNAL

    def redact_element(
        self,
        element: dict
    ) -> dict:
        """Redact sensitive information from DOM element"""
        redacted = element.copy()

        # Check if field is sensitive
        sensitivity = self.check_field_sensitivity(
            element.get("id"),
            element.get("type"),
            element.get("label")
        )

        # For password/email/tel fields, don't expose the value
        if sensitivity == SensitivityLevel.CONFIDENTIAL:
            # Remove value from redacted output
            redacted.pop("value", None)
            redacted["sensitivity"] = "confidential"
            redacted["note"] = "Value redacted for privacy"
            self.redactions_count += 1

        # Check text content for PII
        if element.get("text"):
            pii_result = self.detect_pii(element["text"])
            if pii_result.is_sensitive:
                redacted["text"] = pii_result.redacted_value
                redacted["sensitivity"] = pii_result.sensitivity_level

        return redacted

    def get_stats(self) -> dict:
        """Get privacy detection statistics"""
        return {
            "detections": self.detections_count,
            "redactions": self.redactions_count,
        }


# Global instance
privacy_detector = PrivacyDetector()
