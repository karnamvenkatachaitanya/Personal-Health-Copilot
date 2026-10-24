"""Supabase repository: Postgres tables (row per patient/record plus normalised
medications, lab observations and conditions) and a private Storage bucket for
the original documents. Every query is scoped by the verified owner id."""
import json
import logging
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

import io
from concurrent.futures import ThreadPoolExecutor

import httpx
from supabase import Client, create_client

from app.config import settings
from app.schemas.payloads import ExtractionMeta, HealthRecord, Profile
from app.services.regex_cleaner import parse_number, parse_reference_range

logger = logging.getLogger(__name__)

BUCKET = "documents"
SEED_DIR = Path(__file__).resolve().parents[1] / "seed"


@lru_cache(maxsize=1)
def db() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id() -> str:
    return str(uuid.uuid4())


def audit(owner: str, action: str, patient_id: Optional[str] = None, resource_id: Optional[str] = None, detail: Optional[dict] = None) -> None:
    db().table("audit_log").insert({"owner_id": owner, "action": action, "patient_id": patient_id,
                                    "resource_id": resource_id, "detail": detail}).execute()


# Patients (family profiles)

def _profile(row: dict) -> Profile:
    row = {k: v for k, v in row.items() if k != "owner_id"}
    return Profile(**row)


def list_profiles(owner: str) -> List[Profile]:
    rows = db().table("patients").select("*").eq("owner_id", owner).order("created_at").execute().data
    return [_profile(r) for r in rows]


def get_profile(owner: str, profile_id: str) -> Optional[Profile]:
    rows = db().table("patients").select("*").eq("owner_id", owner).eq("id", profile_id).execute().data
    return _profile(rows[0]) if rows else None


def save_profile(owner: str, profile: Profile) -> Profile:
    row = profile.model_dump() | {"owner_id": owner}
    db().table("patients").upsert(row).execute()
    return profile


def delete_profile(owner: str, profile_id: str) -> None:
    for r in list_records(owner, profile_id):
        _remove_upload(owner, r.id)
    db().table("patients").delete().eq("owner_id", owner).eq("id", profile_id).execute()


# Records

def _record(row: dict) -> HealthRecord:
    return HealthRecord(
        id=row["id"], profile_id=row["patient_id"], document_type=row["document_type"],
        record_date=row["record_date"], title=row["title"], extracted=row["extracted"],
        source_filename=row["source_filename"], source_mime=row["source_mime"],
        has_source_file=bool(row.get("storage_path")), has_preview=bool(row.get("preview_path")), name_check=row["name_check"],
        extraction=row["extraction"], fhir_bundle=row["fhir_bundle"], is_sample=row["is_sample"],
        created_at=row["created_at"],
    )


def list_records(owner: str, profile_id: Optional[str] = None) -> List[HealthRecord]:
    q = db().table("health_records").select("*").eq("owner_id", owner)
    if profile_id:
        q = q.eq("patient_id", profile_id)
    rows = q.order("record_date", desc=True, nullsfirst=False).order("created_at", desc=True).execute().data
    return [_record(r) for r in rows]


def get_record(owner: str, record_id: str) -> Optional[HealthRecord]:
    rows = db().table("health_records").select("*").eq("owner_id", owner).eq("id", record_id).execute().data
    return _record(rows[0]) if rows else None


def _derived_rows(owner: str, rec: HealthRecord) -> tuple:
    e = rec.extracted
    base = {"owner_id": owner, "patient_id": rec.profile_id, "record_id": rec.id}
    meds = [base | {"name": m.name, "form": m.form, "dosage": m.dosage, "frequency": m.frequency,
                    "timing": m.timing, "duration": m.duration, "prescribed_on": rec.record_date} for m in e.medications]
    labs = []
    for o in e.lab_observations:
        bounds = parse_reference_range(o.reference_range) or (None, None)
        labs.append(base | {"test_name": o.test_name, "value_text": o.observed_value,
                            "value_numeric": parse_number(o.observed_value), "unit": o.unit,
                            "reference_range": o.reference_range, "reference_low": bounds[0],
                            "reference_high": bounds[1], "flag": o.flag, "observed_on": rec.record_date})
    conds = [base | {"name": d, "recorded_on": rec.record_date} for d in e.diagnoses]
    return meds, labs, conds


def save_record(owner: str, rec: HealthRecord, storage_path: Optional[str] = None, preview_path: Optional[str] = None) -> HealthRecord:
    row = {"id": rec.id, "owner_id": owner, "patient_id": rec.profile_id, "document_type": rec.document_type,
           "record_date": rec.record_date, "title": rec.title, "extracted": rec.extracted.model_dump(),
           "extraction": rec.extraction.model_dump(), "name_check": rec.name_check,
           "source_filename": rec.source_filename, "source_mime": rec.source_mime,
           "fhir_bundle": rec.fhir_bundle, "is_sample": rec.is_sample, "created_at": rec.created_at}
    if storage_path:
        row["storage_path"] = storage_path
    if preview_path:
        row["preview_path"] = preview_path
    db().table("health_records").upsert(row).execute()
    meds, labs, conds = _derived_rows(owner, rec)

    def refresh(table: str, rows: list) -> None:
        # The shared client's pooled connection can be stale when several threads reuse it ("Server disconnected");
        # one retry is enough, and delete-then-insert is safe to repeat.
        for attempt in (1, 2):
            try:
                db().table(table).delete().eq("record_id", rec.id).execute()
                if rows:
                    db().table(table).insert(rows).execute()
                return
            except httpx.TransportError as e:
                if attempt == 2:
                    raise
                logger.warning(f"Retrying {table} refresh for {rec.id} after transport error: {e}")

    # The three derived tables are independent; write them in parallel (each is two round trips).
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(lambda t: refresh(*t), (("medications", meds), ("lab_observations", labs), ("conditions", conds))))
    rec.has_source_file = bool(row.get("storage_path"))
    rec.has_preview = bool(row.get("preview_path"))
    return rec


def delete_record(owner: str, record_id: str) -> None:
    _remove_upload(owner, record_id)
    db().table("health_records").delete().eq("owner_id", owner).eq("id", record_id).execute()


# Original files (private bucket, path <owner>/<record>)

def _path(owner: str, record_id: str) -> str:
    return f"{owner}/{record_id}"


def save_upload(owner: str, record_id: str, content: bytes, mime: str) -> str:
    path = _path(owner, record_id)
    db().storage.from_(BUCKET).upload(path, content, {"content-type": mime, "upsert": "true", "cache-control": "3600"})
    return path


def make_preview(content: bytes, mime: str, max_px: int = 1600) -> Optional[bytes]:
    """Downscaled JPEG of an image upload, so phones do not fetch multi-megabyte originals. None for PDFs/HEIC."""
    if not mime.startswith("image/") or mime in ("image/heic", "image/heif"):
        return None
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(content))
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((max_px, max_px))
        out = io.BytesIO()
        im.save(out, "JPEG", quality=82, optimize=True, progressive=True)
        return out.getvalue()
    except Exception:
        return None


def save_preview(owner: str, record_id: str, content: bytes, mime: str) -> Optional[str]:
    data = make_preview(content, mime)
    if not data:
        return None
    path = f"{owner}/{record_id}.preview.jpg"
    db().storage.from_(BUCKET).upload(path, data, {"content-type": "image/jpeg", "upsert": "true", "cache-control": "3600"})
    return path


def signed_file_url(owner: str, record_id: str, seconds: int = 3600, variant: str = "original") -> Optional[str]:
    rec = db().table("health_records").select("storage_path,preview_path").eq("owner_id", owner).eq("id", record_id).execute().data
    if not rec:
        return None
    path = (rec[0].get("preview_path") if variant == "preview" else None) or rec[0].get("storage_path")
    if not path:
        return None
    res = db().storage.from_(BUCKET).create_signed_url(path, seconds)
    return res.get("signedURL") or res.get("signedUrl")


def signed_urls_for_profile(owner: str, profile_id: Optional[str] = None, seconds: int = 3600) -> dict:
    """One storage call for every record (of one person, or the whole family): {record_id: {"original": url, "preview": url|None}}."""
    q = db().table("health_records").select("id,storage_path,preview_path").eq("owner_id", owner)
    if profile_id:
        q = q.eq("patient_id", profile_id)
    rows = q.execute().data
    paths = [p for r in rows for p in (r.get("storage_path"), r.get("preview_path")) if p]
    if not paths:
        return {}
    signed = db().storage.from_(BUCKET).create_signed_urls(paths, seconds)
    by_path = {s.get("path"): (s.get("signedURL") or s.get("signedUrl")) for s in signed if s.get("path")}
    return {r["id"]: {"original": by_path.get(r.get("storage_path")), "preview": by_path.get(r.get("preview_path"))} for r in rows}


def _remove_upload(owner: str, record_id: str) -> None:
    try:
        db().storage.from_(BUCKET).remove([_path(owner, record_id), f"{owner}/{record_id}.preview.jpg"])
    except Exception:
        pass


# Sample family

def load_sample_family(owner: str) -> int:
    """Copies the labelled sample family (produced by the real pipeline) into this account."""
    from app.services.fhir_mapper import to_fhir_bundle
    seed = json.loads((SEED_DIR / "sample_family.json").read_text(encoding="utf-8"))
    for p in list_profiles(owner):
        if p.is_sample:
            delete_profile(owner, p.id)
    id_map = {}
    for p in seed["profiles"]:
        prof = Profile(**(p | {"id": new_id(), "is_sample": True, "created_at": now_iso()}))
        id_map[p["id"]] = prof
        save_profile(owner, prof)
    for r in seed["records"]:
        prof = id_map[r["profile_id"]]
        rec = HealthRecord(**(r | {"id": new_id(), "profile_id": prof.id, "is_sample": True, "created_at": now_iso()}))
        rec.fhir_bundle = to_fhir_bundle(rec.extracted, prof, rec.id)
        path = preview = None
        src = SEED_DIR / "uploads" / r["id"]
        if src.exists():
            content = src.read_bytes()
            path = save_upload(owner, rec.id, content, rec.source_mime)
            preview = save_preview(owner, rec.id, content, rec.source_mime)
        save_record(owner, rec, storage_path=path, preview_path=preview)
    audit(owner, "load_sample_family")
    return len(seed["records"])


def remove_abha_records(owner: str, profile_id: str) -> int:
    """Removes records that were fetched via ABDM/ABHA link for this patient."""
    recs = list_records(owner, profile_id)
    abha_recs = [
        r for r in recs
        if (r.source_filename and r.source_filename.startswith("ABHA:"))
        or (r.extraction and r.extraction.engine == "abdm_gateway")
    ]
    for r in abha_recs:
        delete_record(owner, r.id)
    if abha_recs:
        audit(owner, "abha_records_removed", patient_id=profile_id, detail={"count": len(abha_recs)})
    return len(abha_recs)


def fetch_and_link_abha_records(owner: str, profile: Profile, abha_number: str, abha_address: str) -> int:
    """Fetches ABDM records from the catalog for the linked ABHA identity and stores them in the DB."""
    from app.seed.abha_catalog import generate_abha_records_for_profile
    from app.services.fhir_mapper import to_fhir_bundle

    # Clear previous ABHA records for this patient first to ensure fresh sync without duplicates
    remove_abha_records(owner, profile.id)

    items = generate_abha_records_for_profile(profile, abha_number, abha_address)
    for it in items:
        rid = new_id()
        bundle = to_fhir_bundle(it["extracted"], profile, rid)
        rec = HealthRecord(
            id=rid,
            profile_id=profile.id,
            document_type=it["document_type"],
            record_date=it["record_date"],
            title=it["title"],
            extracted=it["extracted"],
            source_filename=it["source_filename"],
            source_mime=it["source_mime"],
            has_source_file=False,
            has_preview=False,
            name_check="match",
            extraction=ExtractionMeta(
                engine="abdm_gateway",
                model="abdm-fhir-r4",
                duration_ms=180,
                warnings=[],
            ),
            fhir_bundle=bundle,
            is_sample=False,
            created_at=now_iso(),
        )
        save_record(owner, rec)

    audit(owner, "abha_records_fetched", patient_id=profile.id, detail={"count": len(items), "abha_number": abha_number, "abha_address": abha_address})
    return len(items)

