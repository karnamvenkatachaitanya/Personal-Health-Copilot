"""The ChatGPT and MCP layer must never read another family's records."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import mcp_service, store

client = TestClient(app)

PATIENT_ROUTES = [
    ("get", "/api/v1/chatgpt/patients"),
    ("get", "/api/v1/chatgpt/patients/Lakshmi/summary"),
    ("get", "/api/v1/chatgpt/patients/Lakshmi/medications"),
    ("get", "/api/v1/chatgpt/patients/Lakshmi/lab-reports"),
]


@pytest.fixture
def no_database(monkeypatch):
    """Fails the test if anything queries Supabase."""
    def boom():
        raise AssertionError("queried the database without an owner")
    monkeypatch.setattr(store, "db", boom)


@pytest.mark.parametrize("method,path", PATIENT_ROUTES)
def test_patient_routes_need_a_token(method, path, no_database):
    assert getattr(client, method)(path).status_code == 401


@pytest.mark.parametrize("method,path", PATIENT_ROUTES)
def test_an_unknown_token_is_rejected(method, path, no_database):
    r = getattr(client, method)(path, headers={"X-API-Key": "phc_mcp_not-a-real-key"})
    assert r.status_code == 401


def test_ask_needs_a_token(no_database):
    r = client.post("/api/v1/chatgpt/ask", json={"query": "What medicines?", "patient_name_or_id": "Lakshmi"})
    assert r.status_code == 401


def test_without_an_owner_only_the_synthetic_sample_family_is_visible(no_database):
    patients = mcp_service.fetch_all_patients(owner=None)
    assert patients and all(p["source"] == "sample_seed" for p in patients)
    profiles = mcp_service.get_all_patient_profiles(owner=None)
    assert {p["data_source"] for p in profiles} == {"sample_seed"}
    lak = mcp_service.resolve_patient("Lakshmi", owner=None)
    assert lak and lak["source"] == "sample_seed"
    assert all(r.get("is_sample") for r in mcp_service.fetch_records_for_patient(lak, owner=None))


def test_owner_scoped_queries_filter_by_owner(monkeypatch):
    calls = []

    class Q:
        def __init__(self, table): self.table = table
        def select(self, *_): return self
        def eq(self, col, val): calls.append((self.table, col, val)); return self
        def execute(self): return type("R", (), {"data": []})()

    class DB:
        def table(self, name): return Q(name)

    monkeypatch.setattr(store, "db", lambda: DB())
    mcp_service.get_all_patient_profiles(owner="user-1")
    assert ("patients", "owner_id", "user-1") in calls
    assert ("health_records", "owner_id", "user-1") in calls


# --- patient matching never guesses -------------------------------------------------------

@pytest.fixture
def family(monkeypatch):
    people = [
        {"id": "p-ram", "name": "Ram", "source": "database"},
        {"id": "p-ramesh", "name": "Ramesh Kumar", "source": "database"},
        {"id": "p-lak", "name": "Lakshmi Devi", "source": "database"},
    ]
    def _fake_fetch(owner=None, allowed_patient_ids=None):
        if allowed_patient_ids:
            return [p for p in people if p["id"] in allowed_patient_ids]
        return people
    monkeypatch.setattr(mcp_service, "fetch_all_patients", _fake_fetch)
    return people


@pytest.mark.parametrize("ident,expected", [
    ("Ram", "p-ram"), ("ramesh", "p-ramesh"), ("Lakshmi", "p-lak"), ("lakshmi devi", "p-lak"), ("p-lak", "p-lak"),
    ("Rameshwar", None), ("Ra", None), ("", None), ("   ", None), ("Kumar Devi", None),
])
def test_resolve_patient_is_exact_or_unique(family, ident, expected):
    hit = mcp_service.resolve_patient(ident, owner="u1")
    assert (hit["id"] if hit else None) == expected


def test_ask_never_answers_about_someone_else(family, monkeypatch):
    called = []
    monkeypatch.setattr(mcp_service, "fetch_records_for_patient", lambda p, owner=None: called.append(p) or [])
    out = mcp_service.ask_health_copilot_service("What medicines?", "Rameshwar", "en", owner="u1")
    assert "could not find exactly one" in out["answer"] and not called
    out = mcp_service.ask_health_copilot_service("What medicines?", None, "en", owner="u1")
    assert out["answer"].startswith("Which family member") and not called


def test_unknown_patient_returns_only_an_error(family):
    assert set(mcp_service.get_patient_summary_service("Nobody", owner="u1")) == {"error"}
    assert set(mcp_service.get_prescribed_medications_service("Nobody", owner="u1")[0]) == {"error"}


# --- drug safety is honest about coverage ------------------------------------------------

def titles(result):
    return {i["title"] for i in result["interactions"]}


def test_indian_brand_names_are_checked():
    r = mcp_service.check_drug_safety_service(["Dolo 650", "Ecosprin 75", "Brufen 400", "Thyronorm 50", "Shelcal"])
    assert {"Stomach bleeding risk", "Thyroid tablet absorbed less"} <= titles(r)
    assert "does not mean the combination is safe" in r["coverage_note"]


def test_class_rules_catch_common_dangerous_pairs():
    r = mcp_service.check_drug_safety_service(["Warfarin", "Ibuprofen", "Aspirin", "Losartan", "Spironolactone"])
    assert {"Bleeding risk", "High potassium", "Kidney strain and weaker blood pressure control"} <= titles(r)
    r = mcp_service.check_drug_safety_service(["Telmisartan 40", "Aceclofenac 100"])
    assert "Kidney strain and weaker blood pressure control" in titles(r)


def test_thyroid_and_iron_from_the_sample_prescription():
    r = mcp_service.check_drug_safety_service(["Levothyroxine 50 mcg", "Ferrous Ascorbate 100 mg", "Cholecalciferol"])
    assert titles(r) == {"Thyroid tablet absorbed less"}
    assert "Cholecalciferol" in r["not_recognised"]


def test_paracetamol_alcohol_advice_is_not_the_standard_maximum():
    r = mcp_service.check_drug_safety_service(["Paracetamol", "alcohol"])
    (item,) = [i for i in r["interactions"] if i["title"] == "Liver strain"]
    assert "3-4" not in item["action"] and "lower" in item["action"]


# --- governance store and policy enforcement ----------------------------------------------

@pytest.fixture
def governance(tmp_path, monkeypatch):
    from app.services import mcp_governance as g
    monkeypatch.setattr(g, "DATA_DIR", tmp_path)
    monkeypatch.setattr(g, "GOVERNANCE_FILE", tmp_path / "store.json")
    monkeypatch.setattr(store, "audit", lambda *a, **k: None)
    monkeypatch.setattr(store, "list_profiles", lambda owner: [])
    return g


def test_store_is_private_and_a_corrupt_file_is_never_overwritten(governance):
    import os, stat
    key = governance.generate_mcp_key("owner-1")["raw_key"]
    mode = stat.S_IMODE(os.stat(governance.GOVERNANCE_FILE).st_mode)
    if os.name != "nt":
        assert mode == 0o600
    assert governance.authenticate_caller(key).owner_id == "owner-1"
    governance.GOVERNANCE_FILE.write_text("{ not json")
    with pytest.raises(governance.GovernanceStoreError):
        governance.authenticate_caller(key)
    assert governance.GOVERNANCE_FILE.read_text() == "{ not json"


def test_audit_trail_hides_question_text_and_is_per_owner(governance):
    governance.log_mcp_activity("owner-1", "ask", {"query": "Is my sugar high?", "patient": "Lakshmi"})
    (entry,) = governance.get_audit_trail("owner-1")
    assert entry["arguments"]["query"] == "<17 characters>" and entry["arguments"]["patient"] == "Lakshmi"
    assert governance.get_audit_trail("owner-2") == []


def test_disabled_tool_is_refused_over_chatgpt(governance, no_database):
    key = governance.generate_mcp_key("owner-1")["raw_key"]
    governance.update_governance_policy("owner-1", enabled_tools=["list_patient_profiles"])
    r = client.get("/api/v1/chatgpt/patients/Lakshmi/lab-reports", headers={"X-API-Key": key})
    assert r.status_code == 403 and "disabled" in r.json()["detail"]


def test_revoked_token_is_refused(governance, no_database):
    key = governance.generate_mcp_key("owner-1")["raw_key"]
    governance.revoke_mcp_key("owner-1")
    assert client.get("/api/v1/chatgpt/patients", headers={"X-API-Key": key}).status_code == 401


def test_token_routes_are_rate_limited(governance, monkeypatch):
    from app.routers import chatgpt_router
    key = governance.generate_mcp_key("owner-1")["raw_key"]
    monkeypatch.setattr(chatgpt_router, "get_all_patient_profiles", lambda **k: [])
    chatgpt_router._TOKEN_WINDOW.reset()
    codes = [client.get("/api/v1/chatgpt/patients", headers={"X-API-Key": key}).status_code for _ in range(31)]
    chatgpt_router._TOKEN_WINDOW.reset()
    assert codes[:30] == [200] * 30 and codes[30] == 429


@pytest.mark.parametrize("meds,title", [
    (["Warfarin 5 mg", "Ciplox 500"], "Warfarin effect increased"),
    (["Folitrax 7.5", "Brufen 400"], "Methotrexate side effects"),
    (["Lanoxin", "Cordarone"], "Digoxin levels rise"),
])
def test_interactions_named_in_the_investigation_report(meds, title):
    assert title in titles(mcp_service.check_drug_safety_service(meds))


def test_per_profile_mcp_keys_isolated_and_dynamic(governance, family):
    # 1. Generate key for Profile A (Ram)
    res_a = governance.generate_mcp_key("owner-1", label="Ram Handshake", profile_id="p-ram")
    key_a = res_a["raw_key"]
    assert res_a["profile_id"] == "p-ram"

    # 2. Generate key for Profile B (Lakshmi)
    res_b = governance.generate_mcp_key("owner-1", label="Lakshmi Handshake", profile_id="p-lak")
    key_b = res_b["raw_key"]
    assert res_b["profile_id"] == "p-lak"

    # 3. Both keys should be active simultaneously
    ctx_a = governance.authenticate_caller(key_a)
    assert ctx_a.profile_id == "p-ram"
    assert ctx_a.allowed_patient_ids == ["p-ram"]

    ctx_b = governance.authenticate_caller(key_b)
    assert ctx_b.profile_id == "p-lak"
    assert ctx_b.allowed_patient_ids == ["p-lak"]

    # 4. Dynamic scoping: generic 'self' or empty queries resolve dynamically to the key's bound profile
    pat_a = mcp_service.resolve_patient("self", owner="u1", allowed_patient_ids=ctx_a.allowed_patient_ids)
    assert pat_a["id"] == "p-ram"

    pat_b = mcp_service.resolve_patient("self", owner="u1", allowed_patient_ids=ctx_b.allowed_patient_ids)
    assert pat_b["id"] == "p-lak"

    # 5. Revoking key A does not revoke key B
    governance.revoke_mcp_key("owner-1", profile_id="p-ram")
    assert governance.authenticate_caller(key_a) is None
    assert governance.authenticate_caller(key_b).profile_id == "p-lak"
