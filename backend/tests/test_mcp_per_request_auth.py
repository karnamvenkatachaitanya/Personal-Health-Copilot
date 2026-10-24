"""An MCP call must authenticate with its own key, never with another caller's."""
import types

import mcp_server


def call_with(headers=None, session_tokens=None, query=None):
    request = types.SimpleNamespace(headers=headers or {}, query_params=query or {})
    return types.SimpleNamespace(request_context=types.SimpleNamespace(request=request), _request_context=object())


def test_anonymous_http_call_never_inherits_the_previous_callers_key(monkeypatch):
    seen = []
    monkeypatch.setattr(mcp_server, "authenticate_caller", lambda token: seen.append(token) or None)
    mcp_server.set_active_token("phc_mcp_someone_else")      # left behind by an earlier caller
    mcp_server.set_request_token("phc_mcp_someone_else")
    assert mcp_server._token_from_call(call_with({})) is None
    assert mcp_server.get_current_context(call_with({})) is None
    assert "phc_mcp_someone_else" not in seen


def test_key_comes_from_this_request_or_its_own_session():
    assert mcp_server._token_from_call(call_with({"authorization": "Bearer phc_mcp_A"})) == "phc_mcp_A"
    assert mcp_server._token_from_call(call_with({"x-mcp-api-key": "phc_mcp_B"})) == "phc_mcp_B"
    assert mcp_server._token_from_call(call_with(query={"api_key": "phc_mcp_C"})) == "phc_mcp_C"
    mcp_server.set_session_token("session-1", "phc_mcp_D")
    assert mcp_server._token_from_call(call_with({"mcp-session-id": "session-1"})) == "phc_mcp_D"
    assert mcp_server._token_from_call(call_with({"mcp-session-id": "guessed"})) is None


def test_stdio_uses_the_key_configured_at_start(monkeypatch):
    monkeypatch.setattr(mcp_server, "_ACTIVE_TOKEN", "phc_mcp_local")
    assert mcp_server._token_from_call(None) == "phc_mcp_local"
