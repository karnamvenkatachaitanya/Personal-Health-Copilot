from contextlib import asynccontextmanager
import logging
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError as PostgrestAPIError
from fastapi.middleware.cors import CORSMiddleware
from mcp.server.streamable_http_manager import TransportSecuritySettings

from app.config import settings
from app.routers import care_plan, ingestion, profiles, search, voice, chatgpt_router, mcp_governance_router
from app.services import store
from app.services.auth import current_user_id
import mcp_server

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_mcp_security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
_mcp_app = mcp_server.app.streamable_http_app(streamable_http_path="/mcp", transport_security=_mcp_security)
_mcp_session_manager = mcp_server.app._lowlevel_server._session_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    if getattr(_mcp_session_manager, "_has_started", False):
        _mcp_session_manager._has_started = False
    async with _mcp_session_manager.run():
        try:
            yield
        finally:
            _mcp_session_manager._has_started = False


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Reads prescriptions, lab reports and discharge summaries, explains them in English, Hindi and Telugu, and keeps one ABDM-aligned FHIR R4 timeline per family member.",
    version="2.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    # Only the real frontends may call the API from a browser. Add more with FRONTEND_ORIGIN (comma-separated).
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "x-mcp-api-key"],
    max_age=600,
)


@app.middleware("http")
async def extract_mcp_auth(request: Request, call_next):
    auth_header = request.headers.get("authorization", "")
    token = None
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
    elif "x-mcp-api-key" in request.headers:
        token = request.headers.get("x-mcp-api-key", "").strip()
    elif "api_key" in request.query_params:
        token = request.query_params.get("api_key", "").strip()

    req_session_id = request.headers.get("mcp-session-id")

    # Tools read the key from their own request (see mcp_server._token_from_call). Here we only
    # remember which key opened which MCP session, so later calls in that session keep it.
    if token and req_session_id:
        mcp_server.set_session_token(req_session_id, token)

    response = await call_next(request)

    resp_session_id = response.headers.get("mcp-session-id")
    if resp_session_id and token:
        mcp_server.set_session_token(resp_session_id, token)

    return response

@app.exception_handler(PostgrestAPIError)
async def _postgrest_error(request: Request, exc: PostgrestAPIError):
    # A malformed id in a URL reaches Postgres as an invalid uuid: that is "not found", not a crash.
    if getattr(exc, "code", None) == "22P02":
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    logging.getLogger("app").error(f"database error: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})


for r in (profiles, ingestion, search, voice, care_plan, chatgpt_router, mcp_governance_router):
    app.include_router(r.router, prefix=settings.API_V1_PREFIX)


@app.post(f"{settings.API_V1_PREFIX}/sample-family", tags=["Demo"])
def load_sample_family(owner: str = Depends(current_user_id)):
    """Adds (or refreshes) the labelled sample family in the signed-in account."""
    return {"records": store.load_sample_family(owner)}


@app.get("/health")
def health():
    return {"status": "ok", "vision": bool(settings.GEMINI_API_KEY or settings.gemini_keys), "language_model": bool(settings.GROQ_API_KEY)}


# Mount MCP Streamable HTTP transport at /mcp
app.mount("", _mcp_app)

