"""
Tests for OllamaProvider's retry/backoff on transient errors (see
DECISIONS.md, "OllamaProvider: retry/backoff on transient errors").

No pytest-asyncio / respx in this project's dependencies — kept dependency-
free by driving the async provider methods with `asyncio.run()` directly and
faking `httpx.AsyncClient` with a small stand-in that returns queued
responses/exceptions in order.
"""

import asyncio

import httpx
import pytest

from app.providers.ollama import OllamaProvider


class _FakeResponse:
    def __init__(self, status_code: int, json_data: dict | None = None):
        self.status_code = status_code
        self._json = json_data or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://fake-ollama/api/chat")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("error", request=request, response=response)

    def json(self) -> dict:
        return self._json


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient: returns queued responses/exceptions in order."""

    queue: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        item = _FakeAsyncClient.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _provider_with_queue(monkeypatch, queue: list, sleeps: list) -> OllamaProvider:
    _FakeAsyncClient.queue = queue
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return OllamaProvider()


def test_retries_once_on_500_then_succeeds(monkeypatch):
    sleeps: list = []
    queue = [
        _FakeResponse(500),
        _FakeResponse(200, {"message": {"content": '{"action":"wait","duration_ms":500}'}}),
    ]
    provider = _provider_with_queue(monkeypatch, queue, sleeps)

    result = asyncio.run(provider._call_ollama())

    assert '"action":"wait"' in result
    assert sleeps == [1.0]  # one retry, base backoff


def test_gives_up_after_max_retries_and_raises(monkeypatch):
    sleeps: list = []
    queue = [_FakeResponse(500), _FakeResponse(500), _FakeResponse(500)]
    provider = _provider_with_queue(monkeypatch, queue, sleeps)

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(provider._call_ollama())

    # MAX_RETRIES=2 -> 3 attempts total, 2 backoff sleeps (exponential)
    assert sleeps == [1.0, 2.0]


def test_does_not_retry_a_client_error(monkeypatch):
    sleeps: list = []
    queue = [_FakeResponse(400)]
    provider = _provider_with_queue(monkeypatch, queue, sleeps)

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(provider._call_ollama())

    assert sleeps == []  # 4xx is not transient - fail fast, no retry


def test_retries_on_timeout(monkeypatch):
    sleeps: list = []
    queue = [
        httpx.TimeoutException("cold model load"),
        _FakeResponse(200, {"message": {"content": '{"action":"wait","duration_ms":500}'}}),
    ]
    provider = _provider_with_queue(monkeypatch, queue, sleeps)

    result = asyncio.run(provider._call_ollama())

    assert '"action":"wait"' in result
    assert sleeps == [1.0]
