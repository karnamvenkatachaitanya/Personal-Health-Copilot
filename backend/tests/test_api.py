"""HTTP-level checks: auth on every data and model endpoint, rate limits, CORS."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import limits, store
from app.services.auth import current_user_id

client = TestClient(app)

PROTECTED = [
    ("get", "/api/v1/profiles"), ("post", "/api/v1/profiles"), ("put", "/api/v1/profiles/x"),
    ("get", "/api/v1/health-records"),
    ("get", "/api/v1/health-records/files"), ("post", "/api/v1/health-records/upload"),
    ("post", "/api/v1/copilot/query"), ("post", "/api/v1/voice/transcribe"),
    ("get", "/api/v1/voice/tts?text=hello&language=en"), ("get", "/api/v1/profiles/x/trends"),
    ("get", "/api/v1/profiles/x/fhir"), ("post", "/api/v1/sample-family"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_every_endpoint_needs_a_signed_in_user(method, path):
    r = getattr(client, method)(path)
    assert r.status_code == 401, (path, r.status_code, r.text)


def test_bad_tokens_are_rejected():
    r = client.get("/api/v1/profiles", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_health_reports_which_engines_are_configured():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


@pytest.fixture
def signed_in(monkeypatch):
    app.dependency_overrides[current_user_id] = lambda: "user-1"
    limits.reset_all()
    yield
    app.dependency_overrides.clear()
    limits.reset_all()


def test_questions_are_rate_limited_per_user(signed_in, monkeypatch):
    monkeypatch.setattr(store, "get_profile", lambda owner, pid: None)
    monkeypatch.setattr(store, "list_records", lambda owner, pid: [])
    body = {"query": "When is her next test?", "language": "en", "profile_id": "p1"}
    codes = [client.post("/api/v1/copilot/query", json=body).status_code for _ in range(13)]
    assert codes[:12] == [404] * 12  # allowed through to the handler (profile missing)
    assert codes[12] == 429
    r = client.post("/api/v1/copilot/query", json=body)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_crisis_screen_runs_before_any_model(signed_in):
    r = client.post("/api/v1/copilot/query", json={"query": "I want to end my life", "language": "en", "profile_id": "p1"})
    assert r.status_code == 200 and r.json()["safety"] == "crisis" and "14416" in r.json()["answer"]


def test_tts_rejects_unknown_languages_and_long_text(signed_in):
    assert client.get("/api/v1/voice/tts", params={"text": "hi", "language": "fr"}).status_code == 422
    assert client.get("/api/v1/voice/tts", params={"text": "a" * 601, "language": "en"}).status_code == 422


def test_trends_endpoint_returns_the_series(signed_in, monkeypatch, profile):
    from tests.test_trends import AUG, OCT
    monkeypatch.setattr(store, "get_profile", lambda owner, pid: profile)
    monkeypatch.setattr(store, "list_records", lambda owner, pid: [AUG, OCT])
    r = client.get("/api/v1/profiles/p1/trends")
    assert r.status_code == 200
    keys = {t["key"]: t["verdict"] for t in r.json()}
    assert keys["haemoglobin"] == "improving" and keys["creatinine"] == "in_range"


@pytest.mark.parametrize("origin,allowed", [
    ("https://mycopilot.qd.je", True), ("https://judges.example.com", True), ("http://localhost:3000", True),
    ("https://evil.example.com", False),
])
def test_cors_only_allows_known_frontends(origin, allowed):
    r = client.options("/api/v1/profiles", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                                                     "Access-Control-Request-Headers": "authorization"})
    assert (r.headers.get("access-control-allow-origin") == origin) is allowed


def test_malformed_record_ids_are_404_not_500(signed_in, monkeypatch):
    from postgrest.exceptions import APIError
    def bad_uuid(*a, **k):
        raise APIError({"message": 'invalid input syntax for type uuid: "nope"', "code": "22P02", "hint": None, "details": None})
    monkeypatch.setattr(store, "get_record", bad_uuid)
    assert client.get("/api/v1/health-records/nope").status_code == 404


def test_update_profile_modifies_details(signed_in, monkeypatch, profile):
    monkeypatch.setattr(store, "get_profile", lambda owner, pid: profile)
    saved_box = []
    monkeypatch.setattr(store, "save_profile", lambda owner, p: (saved_box.append(p), p)[1])
    monkeypatch.setattr(store, "audit", lambda *a, **k: None)

    r = client.put(f"/api/v1/profiles/{profile.id}", json={"name": "Anita Sharma", "relation": "Mother", "age": "52", "sex": "F"})
    assert r.status_code == 200
    res = r.json()
    assert res["name"] == "Anita Sharma"
    assert res["relation"] == "Mother"
    assert res["age"] == "52"
    assert res["sex"] == "F"
    assert len(saved_box) == 1
    assert saved_box[0].name == "Anita Sharma"

