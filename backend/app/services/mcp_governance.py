"""Enterprise MCP Data Governance and Access Control Service.

Provides:
- User-scoped Personal MCP Access Tokens (PAT).
- Per-tool permissions and kill-switch governance.
- Patient-level privacy filtering (control which family profiles are exposed to external LLMs).
- Real-time audit logging for all MCP calls.
"""
from dataclasses import dataclass, field
import hashlib
import json
import logging
import os
from pathlib import Path
import secrets
import tempfile
import threading
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple

from app.services import store

logger = logging.getLogger("mcp_governance")

# Where tokens, policies and the MCP audit trail live. Configurable so a container can point it
# at a writable volume; one instance only (see README) until this moves to the database.
DATA_DIR = Path(os.getenv("MCP_DATA_DIR") or Path(__file__).resolve().parents[2] / "data")
GOVERNANCE_FILE = DATA_DIR / "mcp_governance_store.json"
_LOCK = threading.RLock()
AUDIT_PER_OWNER = 200
REDACT_KEYS = {"query", "question", "text", "message"}

ALL_MCP_TOOLS = [
    "list_patient_profiles",
    "get_patient_summary",
    "get_prescribed_medications",
    "get_lab_reports",
    "check_drug_safety",
    "ask_health_copilot",
    "find_specialist_doctors",
]

DEFAULT_POLICY = {
    "is_active": True,
    "enabled_tools": ALL_MCP_TOOLS,
    "allowed_patient_ids": [],  # Empty means all family members allowed
    "rate_limit_per_minute": 60,
    "require_doctor_confirmation_disclaimer": True,
}


@dataclass
class MCPCallerContext:
    owner_id: str
    token_name: str
    is_active: bool
    enabled_tools: List[str] = field(default_factory=lambda: list(ALL_MCP_TOOLS))
    allowed_patient_ids: List[str] = field(default_factory=list)
    profile_id: Optional[str] = None
    profile_name: Optional[str] = None


class GovernanceStoreError(RuntimeError):
    """The token/policy store could not be read or written. Never treated as 'empty'."""


def _load_store() -> Dict[str, Any]:
    if not GOVERNANCE_FILE.exists():
        return {"policies": {}, "keys": {}, "audit_logs": []}
    try:
        return json.loads(GOVERNANCE_FILE.read_text(encoding="utf-8"))
    except Exception as e:  # a corrupt file must not be silently replaced, or every key is lost
        raise GovernanceStoreError(f"MCP governance store is unreadable: {e}") from e


def _save_store(data: Dict[str, Any]) -> None:
    """Atomic write, readable by the owner only. Raises so a key is never reported as saved when it was not."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".governance-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, GOVERNANCE_FILE)
    except Exception as e:
        raise GovernanceStoreError(f"MCP governance store could not be saved: {e}") from e


@contextmanager
def _mutate():
    """Read-modify-write under one lock, so concurrent requests cannot drop each other's changes."""
    with _LOCK:
        data = _load_store()
        yield data
        _save_store(data)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Key Management & Governance Policy
# ---------------------------------------------------------------------------

def get_or_create_policy(owner_id: str) -> Dict[str, Any]:
    """Retrieves the MCP governance policy for a specific user, syncing active profile keys."""
    with _LOCK:
        data = _load_store()
        policies = data.get("policies", {})
        if owner_id not in policies:
            policies[owner_id] = {
                "owner_id": owner_id,
                "is_active": True,
                "enabled_tools": list(ALL_MCP_TOOLS),
                "allowed_patient_ids": [],
                "created_at": store.now_iso(),
                "updated_at": store.now_iso(),
                "has_generated_key": False,
                "masked_key": None,
                "profile_keys": {},
            }
            data["policies"] = policies
            _save_store(data)

        policy = policies[owner_id]
        profile_keys: Dict[str, Any] = {}
        has_any_key = False
        master_masked = policy.get("masked_key")
        for k_h, k_info in data.get("keys", {}).items():
            if k_info.get("owner_id") == owner_id and k_info.get("is_active"):
                has_any_key = True
                pid = k_info.get("profile_id")
                if pid:
                    profile_keys[pid] = {
                        "masked_key": k_info.get("masked_key"),
                        "label": k_info.get("label"),
                        "created_at": k_info.get("created_at"),
                        "profile_name": k_info.get("profile_name"),
                        "profile_id": pid,
                    }
                else:
                    master_masked = k_info.get("masked_key")

        policy["profile_keys"] = profile_keys
        policy["has_generated_key"] = has_any_key
        if master_masked:
            policy["masked_key"] = master_masked
        return policy


def generate_mcp_key(
    owner_id: str,
    label: str = "Claude Desktop / Cursor",
    profile_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Generates a secure Personal MCP Access Token.
    If profile_id is provided, the handshake key is strictly scoped to that profile.
    If profile_id is None, it acts as an account-level master key."""
    profile_name: Optional[str] = None
    if profile_id:
        try:
            p = store.get_profile(owner_id, profile_id)
            if p:
                profile_name = p.name
                if label == "Claude Desktop / Cursor":
                    label = f"{p.name} Handshake"
        except Exception:
            profile_name = profile_id

    raw_key = f"phc_mcp_{secrets.token_urlsafe(32)}"
    key_h = hash_token(raw_key)
    masked = f"{raw_key[:12]}...{raw_key[-4:]}"
    now = store.now_iso()

    get_or_create_policy(owner_id)
    with _mutate() as data:
        keys = data.setdefault("keys", {})
        # Deactivate previous active keys for this specific scope
        for k_h, k_info in keys.items():
            if k_info.get("owner_id") == owner_id and k_info.get("is_active"):
                if profile_id and k_info.get("profile_id") == profile_id:
                    k_info["is_active"] = False
                    k_info["revoked_at"] = now
                elif not profile_id and not k_info.get("profile_id"):
                    k_info["is_active"] = False
                    k_info["revoked_at"] = now

        keys[key_h] = {
            "owner_id": owner_id,
            "profile_id": profile_id,
            "profile_name": profile_name,
            "label": label[:60],
            "masked_key": masked,
            "is_active": True,
            "created_at": now,
        }

        policy = data.setdefault("policies", {})[owner_id]
        policy["is_active"] = True
        policy["has_generated_key"] = True
        profile_keys = policy.setdefault("profile_keys", {})
        if profile_id:
            profile_keys[profile_id] = {
                "masked_key": masked,
                "label": label[:60],
                "created_at": now,
                "profile_name": profile_name,
                "profile_id": profile_id,
            }
        else:
            policy["masked_key"] = masked
            policy["key_label"] = label[:60]
            policy["key_created_at"] = now

    # Log in system audit trail
    log_mcp_activity(
        owner_id=owner_id,
        tool_name="mcp_key_generated",
        arguments={"label": label, "profile_id": profile_id, "profile_name": profile_name},
        status="SUCCESS",
        client_info="Web Portal",
        patient_name=profile_name,
    )

    return {
        "raw_key": raw_key,
        "masked_key": masked,
        "created_at": now,
        "label": label,
        "profile_id": profile_id,
        "profile_name": profile_name,
        "instructions": "Copy this key now. For security reasons it will not be displayed again.",
    }


def revoke_mcp_key(owner_id: str, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Revokes active MCP key(s). If profile_id is provided, revokes only that profile's key.
    If profile_id is None, revokes all keys for this owner."""
    now = store.now_iso()
    revoked_count = 0
    with _mutate() as data:
        for k_h, k_info in data.setdefault("keys", {}).items():
            if k_info.get("owner_id") == owner_id and k_info.get("is_active"):
                if profile_id:
                    if k_info.get("profile_id") == profile_id:
                        k_info["is_active"] = False
                        k_info["revoked_at"] = now
                        revoked_count += 1
                else:
                    k_info["is_active"] = False
                    k_info["revoked_at"] = now
                    revoked_count += 1

        policies = data.setdefault("policies", {})
        if owner_id in policies:
            policy = policies[owner_id]
            if profile_id:
                if "profile_keys" in policy and profile_id in policy["profile_keys"]:
                    del policy["profile_keys"][profile_id]
            else:
                policy["is_active"] = False
                policy["has_generated_key"] = False
                policy["masked_key"] = None
                policy["profile_keys"] = {}
            policy["updated_at"] = now

    log_mcp_activity(
        owner_id=owner_id,
        tool_name="mcp_key_revoked",
        arguments={"revoked_count": revoked_count, "profile_id": profile_id},
        status="REVOKED",
        client_info="Web Portal",
    )

    return {"status": "revoked", "revoked_count": revoked_count, "profile_id": profile_id, "timestamp": now}


def update_governance_policy(
    owner_id: str,
    is_active: Optional[bool] = None,
    enabled_tools: Optional[List[str]] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Updates fine-grained tool controls and patient exposure limits."""
    get_or_create_policy(owner_id)
    with _mutate() as data:
        policy = data.setdefault("policies", {})[owner_id]
        if is_active is not None:
            policy["is_active"] = is_active
        if enabled_tools is not None:
            policy["enabled_tools"] = [t for t in enabled_tools if t in ALL_MCP_TOOLS]
        if allowed_patient_ids is not None:
            # Only this owner's own profiles can be listed.
            own = {p.id for p in store.list_profiles(owner_id)}
            policy["allowed_patient_ids"] = [p for p in allowed_patient_ids if p in own]
        policy["updated_at"] = store.now_iso()

    log_mcp_activity(
        owner_id=owner_id,
        tool_name="mcp_policy_updated",
        arguments={
            "is_active": policy["is_active"],
            "enabled_tools": policy["enabled_tools"],
            "allowed_patient_ids": policy["allowed_patient_ids"],
        },
        status="UPDATED",
        client_info="Web Portal",
    )

    return policy


# ---------------------------------------------------------------------------
# Authentication & Authorization for MCP Server Invocations
# ---------------------------------------------------------------------------

def authenticate_caller(token: Optional[str]) -> Optional[MCPCallerContext]:
    """Resolves an incoming token or API key to an authenticated user context."""
    if not token or not token.strip():
        # Fallback to local default owner if present in environment
        default_owner = os.getenv("MCP_DEFAULT_OWNER_ID")
        if default_owner:
            return MCPCallerContext(
                owner_id=default_owner,
                token_name="Default Local Dev",
                is_active=True,
                enabled_tools=list(ALL_MCP_TOOLS),
            )
        return None

    clean = token.strip()
    # Support "Bearer phc_mcp_..."
    if clean.lower().startswith("bearer "):
        clean = clean[7:].strip()

    key_h = hash_token(clean)
    data = _load_store()
    keys = data.get("keys", {})
    key_info = keys.get(key_h)

    if not key_info or not key_info.get("is_active"):
        return None

    owner_id = key_info["owner_id"]
    policy = data.get("policies", {}).get(owner_id, {})
    if not policy.get("is_active", True):
        return None

    profile_id = key_info.get("profile_id")
    profile_name = key_info.get("profile_name")

    if profile_id:
        allowed_pids = [profile_id]
    else:
        allowed_pids = policy.get("allowed_patient_ids", [])

    return MCPCallerContext(
        owner_id=owner_id,
        token_name=key_info.get("label", "MCP Token"),
        is_active=True,
        enabled_tools=policy.get("enabled_tools", list(ALL_MCP_TOOLS)),
        allowed_patient_ids=allowed_pids,
        profile_id=profile_id,
        profile_name=profile_name,
    )


def authorize_mcp_request(
    context: Optional[MCPCallerContext],
    tool_name: str,
    patient_id: Optional[str] = None,
) -> Tuple[bool, Optional[str]]:
    """Checks if the authenticated caller is permitted to invoke the specific tool and access patient."""
    if not context:
        return False, "Unauthorized: Valid MCP API Key is required. Please generate a key from your website dashboard."

    if not context.is_active:
        return False, "Forbidden: MCP integration has been disabled or revoked by the account owner."

    if tool_name not in context.enabled_tools:
        return False, f"Forbidden: Tool '{tool_name}' has been disabled in your Data Governance settings on the website."

    if patient_id and context.allowed_patient_ids:
        if patient_id not in context.allowed_patient_ids:
            return False, f"Access Restricted: Patient data access for profile '{patient_id}' is restricted by privacy policy."

    return True, None


# ---------------------------------------------------------------------------
# Audit Trail
# ---------------------------------------------------------------------------

def log_mcp_activity(
    owner_id: str,
    tool_name: str,
    arguments: Optional[Dict[str, Any]] = None,
    status: str = "SUCCESS",
    client_info: str = "MCP stdio / SSE",
    patient_name: Optional[str] = None,
) -> None:
    """Logs every MCP tool invocation into persistent audit logs."""
    safe_args = {k: (f"<{len(str(v))} characters>" if k in REDACT_KEYS else v) for k, v in (arguments or {}).items()}
    entry = {
        "id": store.new_id(),
        "owner_id": owner_id,
        "tool_name": tool_name,
        "arguments": safe_args,
        "patient_name": patient_name or "N/A",
        "status": status,
        "client_info": client_info,
        "timestamp": store.now_iso(),
    }
    try:
        with _mutate() as data:
            logs = [entry] + data.get("audit_logs", [])
            mine = [x for x in logs if x.get("owner_id") == owner_id][:AUDIT_PER_OWNER]
            others = [x for x in logs if x.get("owner_id") != owner_id]
            data["audit_logs"] = mine + others  # each owner keeps their own last 200 entries
    except Exception as e:  # auditing must never break the tool call itself
        logger.warning(f"Failed to record MCP audit log: {e}")
    try:
        store.audit(owner=owner_id, action=f"mcp:{tool_name}", detail={"status": status, "client": client_info, "args": safe_args})
    except Exception:
        pass


def get_audit_trail(owner_id: str, limit: int = 40) -> List[Dict[str, Any]]:
    """Returns the activity audit logs for an owner."""
    data = _load_store()
    logs = [log for log in data.get("audit_logs", []) if log.get("owner_id") == owner_id]
    return logs[:limit]
