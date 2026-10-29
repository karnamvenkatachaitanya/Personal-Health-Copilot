"""Enterprise MCP Governance & Security API Router.

Enables logged-in users to manage Personal MCP Access Tokens (PAT), configure
per-tool governance toggles, restrict patient privacy boundaries, and view live audit trails.
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services.auth import current_user_id
from app.services.mcp_governance import (
    ALL_MCP_TOOLS,
    get_or_create_policy,
    generate_mcp_key,
    revoke_mcp_key,
    update_governance_policy,
    get_audit_trail,
)

router = APIRouter(prefix="/mcp", tags=["MCP Data Governance"])


class UpdatePolicyRequest(BaseModel):
    is_active: Optional[bool] = Field(None, description="Master kill-switch for MCP integration")
    enabled_tools: Optional[List[str]] = Field(None, description="Allowed tool identifiers")
    allowed_patient_ids: Optional[List[str]] = Field(None, description="Family patient IDs permitted for MCP queries")


class GenerateKeyRequest(BaseModel):
    label: str = Field("Claude Desktop / Cursor", description="Name for the access key")
    profile_id: Optional[str] = Field(None, description="Family profile ID to scope handshake key to")


class RevokeKeyRequest(BaseModel):
    profile_id: Optional[str] = Field(None, description="Family profile ID to revoke key for, or None for all")


@router.get("/policy", summary="Get MCP Governance Policy")
def get_policy(owner: str = Depends(current_user_id)) -> Dict[str, Any]:
    """Retrieves current user's MCP configuration, masked key, tool permissions, and privacy filters."""
    policy = get_or_create_policy(owner)
    return {
        "policy": policy,
        "available_tools": ALL_MCP_TOOLS,
        "owner_id": owner,
    }


@router.post("/generate-key", summary="Generate new Personal MCP Access Token")
def generate_key(
    body: Optional[GenerateKeyRequest] = None,
    owner: str = Depends(current_user_id),
) -> Dict[str, Any]:
    """Generates a new secure access key for Claude Desktop / Cursor / ChatGPT and binds to profile if specified."""
    label = body.label if body and body.label else "Claude Desktop / Cursor"
    profile_id = body.profile_id if body else None
    result = generate_mcp_key(owner_id=owner, label=label, profile_id=profile_id)
    return result


@router.post("/revoke-key", summary="Revoke MCP Access Key")
def revoke_key(
    body: Optional[RevokeKeyRequest] = None,
    owner: str = Depends(current_user_id),
) -> Dict[str, Any]:
    """Instantly revokes MCP keys for the specified profile (or all active keys if profile_id not passed)."""
    profile_id = body.profile_id if body else None
    return revoke_mcp_key(owner_id=owner, profile_id=profile_id)


@router.put("/policy", summary="Update MCP Tool Permissions & Privacy Filters")
def update_policy(
    body: UpdatePolicyRequest,
    owner: str = Depends(current_user_id),
) -> Dict[str, Any]:
    """Configures tool-level toggles and patient exposure limits."""
    updated = update_governance_policy(
        owner_id=owner,
        is_active=body.is_active,
        enabled_tools=body.enabled_tools,
        allowed_patient_ids=body.allowed_patient_ids,
    )
    return {"status": "updated", "policy": updated}


@router.get("/audit-trail", summary="Get MCP Activity Audit Trail")
def get_audit_logs(
    limit: int = 40,
    owner: str = Depends(current_user_id),
) -> List[Dict[str, Any]]:
    """Returns chronologically ordered audit logs of all MCP tools executed for this account."""
    return get_audit_trail(owner_id=owner, limit=limit)
