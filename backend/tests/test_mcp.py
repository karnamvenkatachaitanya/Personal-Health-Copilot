import json
import pytest
from starlette.testclient import TestClient
from app.main import app

def parse_sse(text: str):
    for line in text.splitlines():
        if line.startswith("data: "):
            return json.loads(line[6:])
    return None

def test_application_startup_and_health():
    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data.get("status") == "ok"

def test_mcp_initialization_and_tools():
    with TestClient(app) as client:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        # 1. MCP initialize handshake
        init_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "hackathon-test", "version": "1.0"},
            },
        }
        r_init = client.post("/mcp", json=init_payload, headers=headers)
        assert r_init.status_code == 200
        session_id = r_init.headers.get("mcp-session-id")
        assert session_id is not None
        
        init_resp = parse_sse(r_init.text)
        assert init_resp is not None
        assert init_resp.get("result", {}).get("serverInfo", {}).get("name") == "Personal Health Copilot"

        # 2. tools/list
        headers["mcp-session-id"] = session_id
        r_tools = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, headers=headers)
        assert r_tools.status_code == 200
        tools_resp = parse_sse(r_tools.text)
        assert tools_resp is not None
        tool_names = [t["name"] for t in tools_resp["result"]["tools"]]
        assert "get_synthetic_wellness_demo" in tool_names
        assert "check_drug_safety" in tool_names

        # 3. Harmless tools/call (synthetic demo tool)
        r_call = client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "get_synthetic_wellness_demo", "arguments": {"patient_name": "Demo User"}},
            },
            headers=headers,
        )
        assert r_call.status_code == 200
        call_resp = parse_sse(r_call.text)
        assert call_resp is not None
        result_text = call_resp["result"]["content"][0]["text"]
        assert "FICTIONAL DEMO DATA" in result_text
        assert "synthetic_heart_rate_measurements" in result_text

def test_mcp_protocol_headers_validation():
    with TestClient(app) as client:
        # Rejects when client doesn't accept both application/json and text/event-stream
        r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}, headers={"Accept": "application/json"})
        assert r.status_code == 406
