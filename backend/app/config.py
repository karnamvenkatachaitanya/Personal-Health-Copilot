import os
from pydantic_settings import BaseSettings
from typing import List
import app.dns_patch


class Settings(BaseSettings):
    PROJECT_NAME: str = "AI-Powered Personal Health Copilot"
    API_V1_PREFIX: str = "/api/v1"
    
    # AI Engine Keys
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    HF_TOKEN: str = os.getenv("HF_TOKEN", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_API_KEY_FALLBACK: str = os.getenv("GEMINI_API_KEY_FALLBACK", "")
    GEMINI_API_KEYS: str = os.getenv("GEMINI_API_KEYS", "")

    @property
    def gemini_keys(self) -> List[str]:
        keys: List[str] = []
        if self.GEMINI_API_KEYS:
            keys.extend([k.strip() for k in self.GEMINI_API_KEYS.split(",") if k.strip()])
        if self.GEMINI_API_KEY and self.GEMINI_API_KEY.strip() not in keys:
            keys.append(self.GEMINI_API_KEY.strip())
        if self.GEMINI_API_KEY_FALLBACK and self.GEMINI_API_KEY_FALLBACK.strip() not in keys:
            keys.append(self.GEMINI_API_KEY_FALLBACK.strip())
        return keys
    
    # Supabase credentials (optional fallback to in-memory/mock if not provided)
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    SUPABASE_JWKS_URL: str = ""
    SUPABASE_PUBLISHABLE_KEY: str = ""
    
    # Browser origins allowed to call the API. FRONTEND_ORIGIN adds to the known deployments below.
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "")
    KNOWN_ORIGINS: List[str] = [
        "https://mycopilot.qd.je",
        "https://main.d2wddruuen8xa2.amplifyapp.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3010",
        "http://127.0.0.1:3010",
    ]

    @property
    def allowed_origins(self) -> List[str]:
        extra = [o.strip().rstrip("/") for o in self.FRONTEND_ORIGIN.split(",") if o.strip()]
        return list(dict.fromkeys(self.KNOWN_ORIGINS + extra))

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
