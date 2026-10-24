"""Document reading and clinical extraction.

Order of engines:
1. Gemini multimodal vision on the original image or PDF (handles handwriting and Hindi/Telugu print).
2. Groq (Qwen) on text pulled from a digital PDF, when vision is unavailable.
If both fail the upload fails honestly. Nothing here ever invents medicines or values.
"""
import io
import json
import logging
import re
import time
from datetime import date
from typing import List, Any, Dict, Optional, Tuple

from app.config import settings
from app.schemas.payloads import (
    ExtractedRecord, ExtractionMeta, LabObservationItem, Localized, LocalizedList, MedicationItem,
)
from app.services.regex_cleaner import compute_flag, normalize_frequency, split_medication_form

logger = logging.getLogger(__name__)

GEMINI_MODELS = ["gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash"]
# Models that answered "quota exceeded" or "503 high demand" are skipped until this time, so each upload does not pay for doomed retries.
_COOLDOWN_UNTIL: Dict[str, float] = {}
_KEY_COOLDOWN_UNTIL: Dict[str, float] = {}
GROQ_MODEL = "qwen/qwen3.8-27b"
# Total seconds the vision chain may spend on one document. The browser waits 180 s for an
# upload, so the chain must give up (or fall back to the PDF text path) well before that.
VISION_BUDGET_S = 110
PER_CALL_S = 25


class NotMedicalDocument(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class ExtractionFailed(Exception):
    pass


PROMPT = """You read Indian medical documents for patients and their families.
Read the attached document exactly as printed or handwritten. Transcribe, do not infer.

Return ONE JSON object, no markdown:
{
 "is_medical_document": true|false,
 "not_medical_reason": "if false, one short sentence saying what the document is",
 "record_type": "Prescription" | "DiagnosticReport" | "DischargeSummary",
 "record_date": "YYYY-MM-DD or null if no date is printed",
 "patient_name": "as printed, or null",
 "patient_age": "e.g. 52 or null", "patient_sex": "M | F | null",
 "doctor_name": "as printed, or null", "facility_name": "clinic/lab/hospital, or null",
 "diagnoses": ["each diagnosis or condition written on the document, in plain English; add the medical term in brackets only when it differs from the plain words"],
 "medications": [{
   "name": "drug name without Tab/Cap prefix", "form": "Tablet|Capsule|Syrup|Injection|Drops|Topical|Inhaler|null",
   "dosage": "strength as written e.g. 50 mcg", "frequency": "as written e.g. 1-0-1, BD, once a week",
   "timing": "e.g. after food, empty stomach, or null", "duration": "e.g. 30 days, or null",
   "instructions": {"english": "how to take it in one simple sentence", "hindi": "...", "telugu": "..."},
   "uncertain": true if any part was hard to read,
   "source_box": [ymin, xmin, ymax, xmax] of the line where this medicine is written on the image, integers 0-1000, or null for a PDF or if unsure
 }],
 "lab_observations": [{
   "test_name": "as printed", "observed_value": "exactly as printed, keep commas", "unit": "as printed",
   "reference_range": "exactly as printed or null", "flag": "HIGH|LOW|NORMAL|ABNORMAL as marked or implied by the range",
   "explanation": only when the value is outside the range: {"english": "what this test measures and what a high/low result can mean, 1-2 calm sentences, no diagnosis", "hindi": "...", "telugu": "..."},
   "uncertain": true if hard to read,
   "source_box": [ymin, xmin, ymax, xmax] of this test's row (name to value) on the image, integers 0-1000, or null for a PDF or if unsure
 }],
 "summary": {"english": "3-5 short plain sentences for a family member with no medical training: what this document is, what was found or prescribed, what stands out. Mention every out-of-range value by name.", "hindi": "same in simple Hindi", "telugu": "same in simple Telugu"},
 "doctor_questions": {"english": ["2-4 specific questions the patient could ask their doctor about this document"], "hindi": [...], "telugu": [...]},
 "follow_up": "follow-up instruction as written, or null",
 "handwritten": true|false,
 "languages_detected": ["English", "Hindi", ...],
 "unreadable_parts": ["short description of anything you could not read"]
}

Rules:
- Never add a medicine, test, value, date or diagnosis that is not on the document.
- If a field is not on the document use null or an empty list. Do not use today's date.
- Indian documents write dates day first: 02/09/2026 is 2 September 2026, 14-Aug-2026 is 2026-08-14.
- All structured fields (dosage, frequency, timing, duration, test names, diagnoses) in English. Translate non-English instructions into English there; the Hindi/Telugu versions go only inside the summary, instructions, explanation and doctor_questions objects.
- Lab reports: include every test row. Discharge summaries: include discharge medicines AND any lab values listed.
- Do not recommend changing, starting or stopping any medicine. Do not diagnose. Use calm, non-alarming words.
- Hindi in Devanagari, Telugu in Telugu script, simple everyday words.
"""


def _box(raw) -> Optional[List[int]]:
    """A [ymin, xmin, ymax, xmax] box on the 0-1000 grid, or None if it is not a sane box."""
    try:
        y0, x0, y1, x1 = (int(round(float(v))) for v in raw)
    except (TypeError, ValueError):
        return None
    if not (0 <= y0 < y1 <= 1000 and 0 <= x0 < x1 <= 1000) or (y1 - y0) > 400:
        return None
    return [y0, x0, y1, x1]


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def _pdf_text(file_bytes: bytes) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        return "\n".join((p.extract_text() or "") for p in reader.pages).strip()
    except Exception as e:  # pypdf missing or unreadable PDF
        logger.info(f"PDF text layer unavailable: {e}")
        return ""


def _gemini(file_bytes: bytes, mime: str) -> Tuple[Optional[Dict[str, Any]], str, list]:
    errors = []
    keys = getattr(settings, "gemini_keys", []) or ([settings.GEMINI_API_KEY] if settings.GEMINI_API_KEY else [])
    if not keys:
        return None, "", ["Gemini key not configured"]
    from google import genai
    from google.genai import types
    part = types.Part.from_bytes(data=file_bytes, mime_type=mime)
    deadline = time.monotonic() + VISION_BUDGET_S

    for key_idx, key in enumerate(keys):
        masked_key = f"...{key[-4:]}" if len(key) >= 12 else "***"
        if _KEY_COOLDOWN_UNTIL.get(key, 0) > time.time():
            remaining = int(_KEY_COOLDOWN_UNTIL[key] - time.time())
            errors.append(f"key[{key_idx}]({masked_key}): cooling down ({remaining}s remaining)")
            continue

        key_quota_exhausted = False
        for model in GEMINI_MODELS:
            model_key = f"{key[-4:]}:{model}"
            if _COOLDOWN_UNTIL.get(model_key, 0) > time.time():
                errors.append(f"{model} on key[{key_idx}]: cooling down")
                continue
            remaining = deadline - time.monotonic()
            if remaining < 8:
                errors.append("vision time budget used up")
                return None, "", errors
            try:
                # One attempt per call (no hidden SDK retries) and never longer than the budget left.
                client = genai.Client(api_key=key, http_options=types.HttpOptions(
                    timeout=int(min(PER_CALL_S, remaining) * 1000),
                    retry_options=types.HttpRetryOptions(attempts=1)))
                resp = client.models.generate_content(
                    model=model,
                    contents=[part, PROMPT],
                    config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0),
                )
                return json.loads(_strip_fences(resp.text)), model, errors
            except Exception as e:
                msg = str(e)
                logger.warning(f"Gemini {model} on key[{key_idx}]({masked_key}) failed: {msg[:160]}")
                errors.append(f"{model}(key_{key_idx}): {type(e).__name__}")
                is_quota = "RESOURCE_EXHAUSTED" in msg or " 429" in msg or "quota" in msg.lower()
                low = msg.lower()
                # Overloaded or timing out: cool this model down so the next document skips it.
                is_unavailable = any(k in msg for k in ("503", "504", "UNAVAILABLE", "DEADLINE_EXCEEDED")) or any(
                    k in low for k in ("high demand", "overloaded", "timed out", "timeout")) or isinstance(e, TimeoutError)
                if is_quota:
                    delay = re.search(r"retryDelay['\"]?: ?['\"]?(\d+)s", msg)
                    cooldown = int(delay.group(1)) if delay else 600
                    _KEY_COOLDOWN_UNTIL[key] = time.time() + cooldown
                    _COOLDOWN_UNTIL[model_key] = time.time() + cooldown
                    logger.warning(
                        f"Gemini key[{key_idx}] ({masked_key}) hit quota / rate limit. "
                        f"Triggering fallback key routing to next available API key..."
                    )
                    key_quota_exhausted = True
                    break  # Move to the next fallback API key immediately!
                elif is_unavailable:
                    _COOLDOWN_UNTIL[model_key] = time.time() + 180
                    logger.warning(
                        f"Gemini {model} on key[{key_idx}] hit 503/high demand. "
                        f"Cooling down {model} and immediately trying next model/key."
                    )
        if key_quota_exhausted and key_idx < len(keys) - 1:
            logger.info(f"Switched from key[{key_idx}] to fallback key[{key_idx + 1}] for OCR routing.")
    return None, "", errors


def _groq_text(text: str) -> Tuple[Optional[Dict[str, Any]], list]:
    if not settings.GROQ_API_KEY or not text:
        return None, ["no text layer or Groq key"]
    try:
        from groq import Groq
        client = Groq(api_key=settings.GROQ_API_KEY)
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "system", "content": PROMPT},
                      {"role": "user", "content": f"Document text:\n{text[:12000]}"}],
            temperature=0.0,
            max_tokens=1000,  # free-tier output cap; a truncated reply fails to parse and falls through to vision
            response_format={"type": "json_object"},
        )
        return json.loads(_strip_fences(resp.choices[0].message.content)), []
    except Exception as e:
        logger.warning(f"Groq extraction failed: {e}")
        return None, [f"groq: {type(e).__name__}"]


def fhir_bundle_to_text(bundle: Dict[str, Any]) -> str:
    """Renders an ABDM/FHIR R4 bundle as plain lines so the same extraction prompt can read it."""
    lines: list[str] = ["FHIR R4 document bundle (ABDM import)"]
    entries = bundle.get("entry") or []
    for e in entries:
        r = e.get("resource") or {}
        t = r.get("resourceType")
        if t == "Composition":
            lines.append(f"Document: {r.get('title') or (r.get('type') or {}).get('text') or ''} | Date: {(r.get('date') or '')[:10]}")
        elif t == "Patient":
            name = (r.get("name") or [{}])[0]
            lines.append(f"Patient: {name.get('text') or ' '.join(name.get('given', []) + [name.get('family', '')])} | Sex: {r.get('gender') or ''} | DOB: {r.get('birthDate') or ''}")
        elif t == "Practitioner":
            lines.append(f"Doctor: {(r.get('name') or [{}])[0].get('text', '')}")
        elif t == "Organization":
            lines.append(f"Facility: {r.get('name', '')}")
        elif t == "Condition":
            lines.append(f"Diagnosis: {(r.get('code') or {}).get('text') or ''} | Recorded: {r.get('recordedDate') or ''}")
        elif t == "MedicationRequest":
            med = (r.get("medicationCodeableConcept") or {}).get("text") or ""
            dose = "; ".join(d.get("text", "") for d in r.get("dosageInstruction") or [])
            lines.append(f"Medicine: {med} | Instructions: {dose} | Date: {r.get('authoredOn') or ''}")
        elif t == "Observation":
            code = (r.get("code") or {}).get("text") or ""
            q = r.get("valueQuantity") or {}
            num = q.get("value")
            if isinstance(num, float) and num.is_integer():
                num = int(num)
            val = f"{num} {q.get('unit', '')}".strip() if q else (r.get("valueString") or "")
            rr = "; ".join(x.get("text", "") for x in r.get("referenceRange") or [])
            interp = ", ".join(c.get("display", "") for i in r.get("interpretation") or [] for c in i.get("coding") or [])
            lines.append(f"Test: {code} | Result: {val} | Reference range: {rr} | Flag: {interp} | Date: {(r.get('effectiveDateTime') or '')[:10]}")
        elif t == "DiagnosticReport":
            lines.append(f"Report: {(r.get('code') or {}).get('text') or ''} | Conclusion: {r.get('conclusion') or ''}")
    return "\n".join(lines)


def _valid_date(raw: Any) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    try:
        d = date.fromisoformat(raw.strip()[:10])
        return d.isoformat() if d.year > 1950 and d <= date.today() else None
    except ValueError:
        return None


def _localized(obj: Any) -> Optional[Localized]:
    if isinstance(obj, dict) and obj.get("english"):
        return Localized(english=obj["english"], hindi=obj.get("hindi") or None, telugu=obj.get("telugu") or None)
    if isinstance(obj, str) and obj.strip():
        return Localized(english=obj.strip())
    return None


def _record_type(raw: str, data: Dict[str, Any]) -> str:
    r = (raw or "").lower()
    if "discharge" in r:
        return "DischargeSummary"
    if "diag" in r or "lab" in r or "report" in r:
        return "DiagnosticReport"
    if "presc" in r or "rx" in r:
        return "Prescription"
    return "DiagnosticReport" if data.get("lab_observations") and not data.get("medications") else "Prescription"


def normalize(data: Dict[str, Any]) -> Tuple[ExtractedRecord, list]:
    warnings = []
    meds = []
    for m in data.get("medications") or []:
        if not m.get("name"):
            continue
        name, form = split_medication_form(m["name"], m.get("form"))
        meds.append(MedicationItem(
            name=name, form=form, dosage=m.get("dosage") or "",
            frequency=normalize_frequency(m.get("frequency")), timing=m.get("timing"),
            duration=m.get("duration"), instructions=_localized(m.get("instructions")),
            uncertain=bool(m.get("uncertain")), source_box=_box(m.get("source_box")),
        ))
    labs = []
    for o in data.get("lab_observations") or []:
        if not o.get("test_name"):
            continue
        value = str(o.get("observed_value") or "").strip()
        ai_flag = str(o.get("flag") or "").upper()
        computed = compute_flag(value, o.get("reference_range"))
        if computed:
            flag, source = computed, "computed"
            if ai_flag in ("HIGH", "LOW", "NORMAL") and ai_flag != computed:
                warnings.append(f"{o['test_name']}: AI said {ai_flag}, printed range says {computed}. Using the range.")
        elif ai_flag in ("HIGH", "LOW", "NORMAL", "ABNORMAL"):
            flag, source = ai_flag, "document"
        else:
            flag, source = "UNKNOWN", "ai"
        labs.append(LabObservationItem(
            test_name=o["test_name"], observed_value=value, unit=o.get("unit") or "",
            reference_range=o.get("reference_range"), flag=flag, flag_source=source,
            explanation=_localized(o.get("explanation")) if flag in ("HIGH", "LOW", "ABNORMAL") else None,
            uncertain=bool(o.get("uncertain")), source_box=_box(o.get("source_box")),
        ))
    summary = _localized(data.get("summary")) or Localized(english="This document was read, but no summary was produced.")
    q = data.get("doctor_questions") or {}
    questions = LocalizedList(
        english=[s for s in q.get("english", []) if s], hindi=[s for s in q.get("hindi", []) if s],
        telugu=[s for s in q.get("telugu", []) if s],
    ) if isinstance(q, dict) else LocalizedList()
    rec_date = _valid_date(data.get("record_date"))
    if not rec_date:
        warnings.append("No valid date printed on the document.")
    rec = ExtractedRecord(
        record_type=_record_type(data.get("record_type", ""), data),
        record_date=rec_date,
        patient_name=(data.get("patient_name") or None),
        patient_age=str(data["patient_age"]) if data.get("patient_age") else None,
        patient_sex=data.get("patient_sex") or None,
        doctor_name=data.get("doctor_name") or None,
        facility_name=data.get("facility_name") or None,
        diagnoses=[d for d in (data.get("diagnoses") or []) if d],
        medications=meds, lab_observations=labs, summary=summary, doctor_questions=questions,
        follow_up=data.get("follow_up") or None, handwritten=bool(data.get("handwritten")),
        languages_detected=data.get("languages_detected") or [],
        unreadable_parts=[u for u in (data.get("unreadable_parts") or []) if u],
    )
    if not meds and not labs and not rec.diagnoses:
        warnings.append("No medicines, test values or diagnoses were found on this document.")
    return rec, warnings


def extract_document(file_bytes: bytes, mime: str, filename: str) -> Tuple[ExtractedRecord, ExtractionMeta]:
    started = time.monotonic()
    is_pdf = mime == "application/pdf" or file_bytes[:4] == b"%PDF"
    mime = "application/pdf" if is_pdf else mime
    if mime == "application/json":
        # ABDM / FHIR R4 import: render the bundle as text and run it through the same prompt.
        try:
            bundle = json.loads(file_bytes.decode("utf-8"))
            assert isinstance(bundle, dict) and bundle.get("resourceType") == "Bundle"
        except Exception:
            raise NotMedicalDocument("This JSON file is not a FHIR R4 Bundle.")
        data, errors = _groq_text(fhir_bundle_to_text(bundle))
        if data is None:
            raise ExtractionFailed("; ".join(errors) or "no engine available")
        if data.get("is_medical_document") is False:
            raise NotMedicalDocument(data.get("not_medical_reason") or "This bundle holds no medical records.")
        record, warnings = normalize(data)
        meta = ExtractionMeta(engine="FHIR import", model=GROQ_MODEL, duration_ms=int((time.monotonic() - started) * 1000), warnings=warnings)
        return record, meta
    data, model, errors, engine = None, "", [], "Gemini vision"
    pdf_text = _pdf_text(file_bytes) if is_pdf else ""
    data, model, errs = _gemini(file_bytes, mime)
    errors += errs
    if data is None and pdf_text:
        data, errs = _groq_text(pdf_text)
        errors += errs
        engine, model = "PDF text + Groq", GROQ_MODEL
    if data is None:
        raise ExtractionFailed("; ".join(errors) or "no engine available")
    if data.get("is_medical_document") is False:
        raise NotMedicalDocument(data.get("not_medical_reason") or "This does not look like a medical document.")
    record, warnings = normalize(data)
    meta = ExtractionMeta(engine=engine, model=model, duration_ms=int((time.monotonic() - started) * 1000), warnings=warnings)
    return record, meta
