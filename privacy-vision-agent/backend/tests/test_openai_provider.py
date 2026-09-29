"""
Tests for OpenAIProvider._parse_response.

Regression coverage: the parser used to build ActionResponse from only
action_type/target_id/value/confidence/reason, silently dropping
option/direction/amount/duration_ms/url. Since ActionValidator requires
`direction` for scroll, `option` for select, and `url` for navigate, every
scroll/select/navigate action the model produced was rejected and swapped
for a no-op wait downstream in the websocket handler, even though the model
responded correctly.
"""

from app.providers.openai import OpenAIProvider


def _provider() -> OpenAIProvider:
    return OpenAIProvider(api_key="fake-key")


def test_parse_response_preserves_scroll_direction_and_amount():
    provider = _provider()
    action = provider._parse_response(
        '{"action_type":"scroll","direction":"down","amount":300,'
        '"reason":"scroll to reveal more","confidence":0.8}'
    )

    assert action.action_type == "scroll"
    assert action.direction == "down"
    assert action.amount == 300


def test_parse_response_preserves_select_option():
    provider = _provider()
    action = provider._parse_response(
        '{"action_type":"select","target_id":"country","option":"IN",'
        '"reason":"choose country","confidence":0.9}'
    )

    assert action.action_type == "select"
    assert action.target_id == "country"
    assert action.option == "IN"


def test_parse_response_preserves_navigate_url():
    provider = _provider()
    action = provider._parse_response(
        '{"action_type":"navigate","url":"https://example.com/next",'
        '"reason":"go to next step","confidence":0.7}'
    )

    assert action.action_type == "navigate"
    assert action.url == "https://example.com/next"


def test_parse_response_preserves_wait_duration():
    provider = _provider()
    action = provider._parse_response(
        '{"action_type":"wait","duration_ms":1500,'
        '"reason":"waiting for page load","confidence":0.6}'
    )

    assert action.action_type == "wait"
    assert action.duration_ms == 1500


def test_parse_response_handles_markdown_code_fence():
    provider = _provider()
    action = provider._parse_response(
        '```json\n{"action_type":"click","target_id":"submit",'
        '"reason":"submit form","confidence":0.95}\n```'
    )

    assert action.action_type == "click"
    assert action.target_id == "submit"


def test_parse_response_falls_back_to_wait_on_invalid_json():
    provider = _provider()
    action = provider._parse_response("not json at all")

    assert action.action_type == "wait"
    assert action.confidence == 0.0
