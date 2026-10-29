"""Core clinical data and safety logic for MCP and ChatGPT Connectors.

Shared between:
  - backend/mcp_server.py (Claude Desktop / Cursor stdio & SSE)
  - backend/app/routers/chatgpt_router.py (ChatGPT Custom GPT Actions)
  - backend/app/routers/mcp_governance_router.py (Web Portal Governance API)
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

from app.config import settings
from app.schemas.payloads import Profile, HealthRecord
from app.services import store
from app.services.guardrails import DISCLAIMER, crisis_reply
from app.services.ai_router import answer_question, CopilotUnavailable
from app.services.hospital_finder import get_doctor_recommendations

logger = logging.getLogger("mcp_service")


# ---------------------------------------------------------------------------
# Data Access Helpers
# ---------------------------------------------------------------------------

def load_seed_data() -> Dict[str, Any]:
    """Loads sample family records from the local seed file as a guaranteed fallback."""
    seed_path = store.SEED_DIR / "sample_family.json"
    if seed_path.exists():
        try:
            return json.loads(seed_path.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"Failed to read seed file: {e}")
    return {"profiles": [], "records": []}


def fetch_all_patients(
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Aggregates patients strictly isolated by the owner account with privacy filters."""
    patients: List[Dict[str, Any]] = []
    seen_ids = set()

    # 1. Fetch from Supabase. Only ever for a verified owner: the service key bypasses
    #    row-level security, so an unscoped query would return every family's records.
    try:
        rows = store.db().table("patients").select("*").eq("owner_id", owner).execute().data if owner else []
        for r in rows:
            patients.append({
                "id": r["id"],
                "name": r["name"],
                "relation": r.get("relation", "Self"),
                "age": r.get("age"),
                "sex": r.get("sex"),
                "source": "database",
                "owner_id": r.get("owner_id"),
            })
            seen_ids.add(r["id"])
    except Exception as e:
        logger.warning(f"Supabase patient query note: {e}")

    # 2. Add seed family profiles only if no database records exist for local dev/demo
    if not patients and not owner:
        seed = load_seed_data()
        for p in seed.get("profiles", []):
            if p["id"] not in seen_ids and not any(x["name"].lower() == p["name"].lower() for x in patients):
                patients.append({
                    "id": p["id"],
                    "name": p["name"],
                    "relation": p.get("relation", "Family member"),
                    "age": p.get("age"),
                    "sex": p.get("sex"),
                    "source": "sample_seed",
                    "owner_id": "seed",
                })
                seen_ids.add(p["id"])

    # 3. Apply patient-level privacy filter from governance policy
    if allowed_patient_ids:
        allowed_set = set(allowed_patient_ids)
        patients = [p for p in patients if p["id"] in allowed_set]

    return patients


def resolve_patient(
    identifier: str,
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Finds one patient by id or name within the owner's scope.
    If the key is scoped to a single family profile, generic aliases like 'self', 'me', 'my'
    or empty values dynamically and seamlessly resolve to that profile."""
    clean = (identifier or "").strip().lower()
    patients = fetch_all_patients(owner=owner, allowed_patient_ids=allowed_patient_ids)
    if not patients:
        return None

    # Common AI / patient aliases when interacting with personal assistant
    if not clean:
        return patients[0] if (len(patients) == 1 or allowed_patient_ids) else None

    # Common AI / patient aliases when interacting with personal assistant
    if clean in ("self", "me", "my", "patient", "current", "active", "default", "profile", "user"):
        if len(patients) == 1 or allowed_patient_ids:
            return patients[0]
        for p in patients:
            if p.get("relation", "").lower() == "self":
                return p
        return None

    for p in patients:
        if p["id"].lower() == clean or p["name"].lower() == clean:
            return p
    words = [w for w in re.findall(r"[^\W\d_]+", clean) if len(w) > 1]
    if not words:
        return patients[0] if (len(patients) == 1 or allowed_patient_ids) else None

    def matches(p: Dict[str, Any]) -> bool:
        name_words = re.findall(r"[^\W\d_]+", p["name"].lower())
        return all(any(n == w or n.startswith(w) for n in name_words) for w in words)

    hits = [p for p in patients if matches(p)]
    if len(hits) == 1:
        return hits[0]
    # If the handshake key is strictly scoped to one patient, default to that patient
    if len(patients) == 1 and allowed_patient_ids:
        return patients[0]
    return None


def fetch_records_for_patient(
    patient: Dict[str, Any],
    owner: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Fetches all clinical records belonging to a patient, strictly owner-scoped."""
    patient_id = patient["id"]
    source = patient.get("source", "database")
    records: List[Dict[str, Any]] = []

    if source == "database" and owner:
        try:
            records = (store.db().table("health_records").select("*")
                       .eq("patient_id", patient_id).eq("owner_id", owner).execute().data)
        except Exception as e:
            logger.warning(f"Supabase records query note for {patient_id}: {e}")

    if not records:
        seed = load_seed_data()
        records = [r for r in seed.get("records", []) if r.get("profile_id") == patient_id]

    return records


# ---------------------------------------------------------------------------
# Business Clinical Services
# ---------------------------------------------------------------------------

def get_all_patient_profiles(
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    patients = fetch_all_patients(owner=owner, allowed_patient_ids=allowed_patient_ids)
    record_counts: Dict[str, int] = {}

    try:
        rows = store.db().table("health_records").select("id,patient_id").eq("owner_id", owner).execute().data if owner else []
        for r in rows:
            pid = r.get("patient_id")
            if pid:
                record_counts[pid] = record_counts.get(pid, 0) + 1
    except Exception as e:
        logger.warning(f"Could not batch count database records: {e}")

    if not record_counts:
        seed = load_seed_data()
        for r in seed.get("records", []):
            pid = r.get("profile_id")
            if pid:
                record_counts[pid] = record_counts.get(pid, 0) + 1

    result = []
    for p in patients:
        count = record_counts.get(p["id"], 0)
        result.append({
            "patient_id": p["id"],
            "name": p["name"],
            "age": p.get("age") or "Not recorded",
            "relation": p.get("relation") or "Self",
            "sex": p.get("sex") or "Not recorded",
            "clinical_documents_count": count,
            "data_source": p.get("source", "database"),
        })
    return result


def get_patient_summary_service(
    patient_name_or_id: str,
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    patient = resolve_patient(patient_name_or_id, owner=owner, allowed_patient_ids=allowed_patient_ids)
    if not patient:
        return {
            "error": f"Patient '{patient_name_or_id}' not found or access restricted by privacy settings. Call list_patient_profiles to view available patients.",
        }

    records = fetch_records_for_patient(patient, owner=owner)
    all_diagnoses = set()
    medications_list = []
    lab_tests_list = []
    visits = []

    for r in records:
        ext = r.get("extracted", {})
        doc_date = r.get("record_date") or ext.get("record_date") or "Unknown"
        doc_type = r.get("document_type") or ext.get("record_type") or "Document"
        doctor = ext.get("doctor_name") or "Treating Physician"
        facility = ext.get("facility_name") or "Clinic / Hospital"

        for d in ext.get("diagnoses", []):
            all_diagnoses.add(d)

        for m in ext.get("medications", []):
            medications_list.append({
                "name": m.get("name"),
                "dosage": m.get("dosage"),
                "frequency": m.get("frequency"),
                "timing": m.get("timing"),
                "prescribed_on": doc_date,
            })

        for l in ext.get("lab_observations", []):
            lab_tests_list.append({
                "test_name": l.get("test_name"),
                "value": l.get("observed_value"),
                "unit": l.get("unit"),
                "flag": l.get("flag", "NORMAL"),
                "date": doc_date,
            })

        visits.append({
            "title": r.get("title", f"{doc_type} - {doctor}"),
            "date": doc_date,
            "doctor": doctor,
            "facility": facility,
            "document_type": doc_type,
        })

    return {
        "patient": {
            "id": patient["id"],
            "name": patient["name"],
            "age": patient.get("age"),
            "relation": patient.get("relation"),
            "sex": patient.get("sex"),
        },
        "diagnosed_conditions": sorted(list(all_diagnoses)),
        "active_medications_count": len(medications_list),
        "active_medications_preview": medications_list[:6],
        "recent_lab_observations_count": len(lab_tests_list),
        "recent_lab_observations_preview": lab_tests_list[:6],
        "clinical_encounters": visits,
    }


def get_prescribed_medications_service(
    patient_name_or_id: str,
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    patient = resolve_patient(patient_name_or_id, owner=owner, allowed_patient_ids=allowed_patient_ids)
    if not patient:
        return [{"error": f"Patient '{patient_name_or_id}' not found or access restricted. Call list_patient_profiles to view available patients."}]

    records = fetch_records_for_patient(patient, owner=owner)
    meds_output = []

    for r in records:
        ext = r.get("extracted", {})
        doc_date = r.get("record_date") or ext.get("record_date") or "Unknown"
        doctor = ext.get("doctor_name") or "Treating Doctor"
        facility = ext.get("facility_name") or "Medical Center"

        for m in ext.get("medications", []):
            instructions = m.get("instructions") or {}
            meds_output.append({
                "medication_name": m.get("name"),
                "form": m.get("form") or "Tablet",
                "dosage": m.get("dosage") or "As prescribed",
                "frequency": m.get("frequency") or "As directed",
                "timing": m.get("timing") or "Not specified",
                "duration": m.get("duration") or "Course as advised",
                "instructions_english": instructions.get("english") if isinstance(instructions, dict) else str(instructions),
                "instructions_hindi": instructions.get("hindi") if isinstance(instructions, dict) else None,
                "instructions_telugu": instructions.get("telugu") if isinstance(instructions, dict) else None,
                "prescribing_doctor": doctor,
                "facility": facility,
                "prescription_date": doc_date,
            })

    return meds_output


def get_lab_reports_service(
    patient_name_or_id: str,
    test_name_filter: Optional[str] = None,
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    patient = resolve_patient(patient_name_or_id, owner=owner, allowed_patient_ids=allowed_patient_ids)
    if not patient:
        return [{
            "error": f"Patient '{patient_name_or_id}' not found or access restricted.",
            "test_name": "None",
        }]

    records = fetch_records_for_patient(patient, owner=owner)
    labs_output = []
    filter_lower = test_name_filter.lower().strip() if test_name_filter else None

    for r in records:
        ext = r.get("extracted", {})
        doc_date = r.get("record_date") or ext.get("record_date") or "Unknown"
        facility = ext.get("facility_name") or "Diagnostic Laboratory"

        for obs in ext.get("lab_observations", []):
            name = obs.get("test_name", "")
            if filter_lower and filter_lower not in name.lower():
                continue

            labs_output.append({
                "test_name": name,
                "observed_value": obs.get("observed_value"),
                "unit": obs.get("unit") or "",
                "reference_range": obs.get("reference_range") or "Standard bounds",
                "flag": obs.get("flag", "NORMAL"),
                "test_date": doc_date,
                "diagnostic_center": facility,
            })

    return labs_output


# ---------------------------------------------------------------------------
# Drug Safety
# ---------------------------------------------------------------------------

# Common Indian brand names -> generic, so "Dolo 650" or "Telma 40" are checked too.
BRANDS = {
    "dolo": "paracetamol", "crocin": "paracetamol", "calpol": "paracetamol", "p-650": "paracetamol",
    "ecosprin": "aspirin", "disprin": "aspirin", "loprin": "aspirin",
    "brufen": "ibuprofen", "ibugesic": "ibuprofen", "combiflam": "ibuprofen paracetamol",
    "voveran": "diclofenac", "zerodol": "aceclofenac", "hifenac": "aceclofenac", "meftal": "mefenamic",
    "thyronorm": "levothyroxine", "eltroxin": "levothyroxine", "thyrox": "levothyroxine",
    "shelcal": "calcium", "calcimax": "calcium", "cipcal": "calcium",
    "telma": "telmisartan", "telmikind": "telmisartan", "losar": "losartan", "olmezest": "olmesartan",
    "cardace": "ramipril", "envas": "enalapril", "amlong": "amlodipine", "stamlo": "amlodipine",
    "glycomet": "metformin", "gluconorm": "metformin", "amaryl": "glimepiride",
    "atorva": "atorvastatin", "storvas": "atorvastatin", "rosuvas": "rosuvastatin",
    "pan ": "pantoprazole", "pan-d": "pantoprazole", "pantocid": "pantoprazole", "razo": "rabeprazole", "omez": "omeprazole",
    "warf": "warfarin", "acitrom": "acenocoumarol", "eliquis": "apixaban", "xarelto": "rivaroxaban",
    "clopilet": "clopidogrel", "plavix": "clopidogrel", "aldactone": "spironolactone",
    "levocet": "levocetirizine", "orofer": "ferrous", "autrin": "ferrous", "livogen": "ferrous",
    "ciplox": "ciprofloxacin", "cifran": "ciprofloxacin", "lanoxin": "digoxin", "cordarone": "amiodarone",
    "folitrax": "methotrexate", "imutrex": "methotrexate",
}
CLASSES = {
    "nsaid": ["ibuprofen", "diclofenac", "naproxen", "aceclofenac", "mefenamic", "ketorolac", "etoricoxib"],
    "bp_raas": ["telmisartan", "losartan", "olmesartan", "valsartan", "ramipril", "enalapril", "lisinopril"],
    "potassium_sparing": ["spironolactone", "eplerenone", "amiloride"],
    "anticoagulant": ["warfarin", "acenocoumarol", "apixaban", "rivaroxaban", "dabigatran"],
    "antiplatelet": ["aspirin", "clopidogrel", "ticagrelor", "prasugrel"],
    "thyroid": ["levothyroxine", "thyroxine"],
    "methotrexate": ["methotrexate"],
    "binds_thyroid": ["calcium", "ferrous", "iron"],
}
CLASS_RULES = [
    ("nsaid", "bp_raas", "HIGH", "Kidney strain and weaker blood pressure control",
     "Painkillers like ibuprofen or diclofenac can reduce how well blood pressure medicines work and can strain the kidneys.",
     "Ask your doctor or pharmacist before taking these painkillers. Paracetamol is often preferred, but confirm first."),
    ("nsaid", "anticoagulant", "HIGH", "Bleeding risk",
     "Painkillers like ibuprofen add to the bleeding risk of blood thinners.",
     "Do not combine without your doctor's advice."),
    ("antiplatelet", "anticoagulant", "HIGH", "Bleeding risk",
     "Aspirin or clopidogrel together with a blood thinner raises bleeding risk.",
     "Only take both if your doctor prescribed them together."),
    ("nsaid", "antiplatelet", "HIGH", "Stomach bleeding risk",
     "Painkillers like ibuprofen with aspirin raise the risk of stomach bleeding, and ibuprofen can blunt aspirin's protective effect.",
     "Ask your doctor before combining them."),
    ("nsaid", "methotrexate", "HIGH", "Methotrexate side effects",
     "Painkillers like ibuprofen can slow how the kidneys clear methotrexate, raising its side effects.",
     "Ask the doctor who prescribed methotrexate before taking any painkiller."),
    ("bp_raas", "potassium_sparing", "HIGH", "High potassium",
     "These blood pressure medicines together can push potassium too high.",
     "Your doctor may want a potassium blood test. Do not stop either without asking."),
    ("thyroid", "binds_thyroid", "MODERATE", "Thyroid tablet absorbed less",
     "Calcium and iron tablets reduce how much thyroid tablet the body absorbs.",
     "Take the thyroid tablet first thing in the morning on an empty stomach, and calcium or iron at least 4 hours later."),
]
PAIR_RULES = [
    (["paracetamol", "alcohol"], "HIGH", "Liver strain",
     "Regular alcohol with paracetamol raises the risk of liver damage.",
     "Avoid alcohol while taking paracetamol. If you drink regularly, ask your doctor what daily dose is safe for you; it is often lower than the usual maximum."),
    (["metformin", "alcohol"], "HIGH", "Lactic acidosis and low sugar risk",
     "Heavy drinking with metformin raises the risk of lactic acidosis and low blood sugar.",
     "Avoid heavy or binge drinking. Ask your doctor what is safe."),
    (["levocetirizine", "alcohol"], "MODERATE", "Extra drowsiness",
     "Alcohol adds to the drowsiness from this antihistamine.",
     "Do not drive after taking both."),
    (["warfarin", "ciprofloxacin"], "HIGH", "Warfarin effect increased",
     "Ciprofloxacin can raise the blood-thinning effect of warfarin and the risk of bleeding.",
     "Tell the prescribing doctor you take warfarin; an INR check is often needed."),
    (["digoxin", "amiodarone"], "HIGH", "Digoxin levels rise",
     "Amiodarone raises digoxin levels in the blood, which can cause slow heart rate, nausea or vision changes.",
     "Your doctor usually lowers the digoxin dose and checks levels. Do not change doses yourself."),
    (["atorvastatin", "clarithromycin"], "HIGH", "Muscle damage risk",
     "Clarithromycin raises atorvastatin levels, which can damage muscles.",
     "Tell the doctor prescribing the antibiotic that you take atorvastatin."),
]
FOOD_RULES = {
    "levothyroxine": "Take on an empty stomach first thing in the morning with plain water. Wait 30 to 45 minutes before tea, coffee or breakfast.",
    "paracetamol": "Can be taken with or without food.",
    "metformin": "Take with or right after meals to reduce stomach upset.",
    "telmisartan": "Take at the same time each day. Avoid potassium-based salt substitutes unless your doctor agrees.",
    "atorvastatin": "Usually taken at night. Avoid large amounts of grapefruit juice.",
    "levocetirizine": "Often taken at night because it can cause drowsiness.",
    "pantoprazole": "Take 30 to 60 minutes before breakfast.",
    "ferrous": "Iron is absorbed better with vitamin C and less with tea, coffee, milk or calcium taken at the same time.",
}
NOT_EXHAUSTIVE = ("This check covers a short list of well-known interactions and common Indian brand names. "
                  "'No interactions found' does not mean the combination is safe. Ask your pharmacist or doctor before "
                  "starting, stopping or combining medicines.")


def _generic_names(med: str) -> str:
    m = f" {med.strip().lower()} "
    out = [m]
    for brand, generic in BRANDS.items():
        if brand in m:
            out.append(generic)
    return " ".join(out)


def check_drug_safety_service(medications: List[str]) -> Dict[str, Any]:
    clean = [m.strip() for m in medications if m and m.strip()][:20]
    expanded = {m: _generic_names(m) for m in clean}
    joined = " ".join(expanded.values())

    def has(word: str) -> List[str]:
        return [m for m, g in expanded.items() if word in g]

    def has_class(cls: str) -> List[str]:
        return sorted({m for w in CLASSES[cls] for m in has(w)})

    found, seen = [], set()
    for a, b, sev, title, desc, action in CLASS_RULES:
        ma, mb = has_class(a), has_class(b)
        pair = tuple(sorted(set(ma) | set(mb)))
        if ma and mb and set(ma) != set(mb) and (title, pair) not in seen:
            seen.add((title, pair))
            found.append({"drugs_involved": list(pair), "severity": sev, "title": title, "description": desc, "action": action})
    for drugs, sev, title, desc, action in PAIR_RULES:
        hits = [has(d) for d in drugs]
        if all(hits):
            involved = sorted({m for h in hits for m in h})
            found.append({"drugs_involved": involved, "severity": sev, "title": title, "description": desc, "action": action})

    duplicates = []
    for cls, label in (("nsaid", "painkillers of the NSAID type"), ("anticoagulant", "blood thinners"), ("bp_raas", "blood pressure medicines of the same family")):
        members = has_class(cls)
        if len(members) > 1:
            duplicates.append(f"More than one of the {label}: {', '.join(members)}. Check with your doctor that this is intended.")
    ppis = sorted({m for w in ("pantoprazole", "omeprazole", "rabeprazole", "esomeprazole") for m in has(w)})
    if len(ppis) > 1:
        duplicates.append(f"More than one acid reducer: {', '.join(ppis)}. Usually only one is needed.")

    food = {}
    for key, rule in FOOD_RULES.items():
        for m in has(key):
            food[m] = rule
    recognised = [m for m, g in expanded.items() if any(w in g for ws in CLASSES.values() for w in ws)
                  or any(k in g for k in FOOD_RULES) or any(w in g for d, *_ in PAIR_RULES for w in d)]
    return {
        "medications_analyzed": clean,
        "recognised": recognised,
        "not_recognised": [m for m in clean if m not in recognised],
        "interactions_found_count": len(found),
        "interactions": found,
        "duplicate_class_warnings": duplicates,
        "food_and_timing_guidelines": food,
        "coverage_note": NOT_EXHAUSTIVE,
        "clinical_disclaimer": NOT_EXHAUSTIVE,
    }


def ask_health_copilot_service(
    query: str,
    patient_name_or_id: Optional[str] = None,
    language: str = "en",
    owner: Optional[str] = None,
    allowed_patient_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    lang = language.lower() if language in ("en", "hi", "te") else "en"
    disclaimer = DISCLAIMER.get(lang, DISCLAIMER["en"])

    crisis = crisis_reply(query, lang)
    if crisis:
        return {
            "answer": crisis,
            "safety": "CRISIS_ALERT",
            "emergency_numbers": ["112 (Emergency Ambulance / Police)", "108 (National Ambulance)", "14416 (Tele-MANAS Free Mental Health)"],
            "disclaimer": disclaimer,
            "citations": [],
            "suggested_followups": ["Call 112 immediately", "Go to the nearest hospital emergency room"],
        }

    patient = None
    if patient_name_or_id and patient_name_or_id.strip():
        patient = resolve_patient(patient_name_or_id, owner=owner, allowed_patient_ids=allowed_patient_ids)
        if not patient:
            names = [p["name"] for p in fetch_all_patients(owner=owner, allowed_patient_ids=allowed_patient_ids)]
            return {
                "answer": f"I could not find exactly one family member called '{patient_name_or_id}'. "
                          f"Available: {', '.join(names) or 'none'}. Please say which person you mean.",
                "safety": "ok", "citations": [], "disclaimer": disclaimer,
            }
    else:
        patients = fetch_all_patients(owner=owner, allowed_patient_ids=allowed_patient_ids)
        if len(patients) == 1:
            patient = patients[0]
        elif patients:
            return {
                "answer": f"Which family member is this about? Available: {', '.join(p['name'] for p in patients)}.",
                "safety": "ok", "citations": [], "disclaimer": disclaimer,
            }

    if not patient:
        return {
            "answer": "No patient records found in your personal account or access is restricted by privacy policy.",
            "safety": "ok",
            "citations": [],
            "disclaimer": disclaimer,
        }

    records_raw = fetch_records_for_patient(patient, owner=owner)
    if not records_raw:
        return {
            "answer": f"No medical documents are currently uploaded for {patient['name']}.",
            "patient": patient["name"],
            "safety": "ok",
            "citations": [],
            "disclaimer": disclaimer,
        }

    prof = Profile(
        id=patient["id"],
        name=patient["name"],
        relation=patient.get("relation", "Self"),
        age=patient.get("age"),
        sex=patient.get("sex"),
        created_at="2026-01-01T00:00:00Z",
    )

    records: List[HealthRecord] = []
    for r in records_raw:
        try:
            records.append(HealthRecord(
                id=r["id"],
                profile_id=patient["id"],
                document_type=r.get("document_type", "Prescription"),
                record_date=r.get("record_date"),
                title=r.get("title", "Clinical Document"),
                extracted=r["extracted"],
                source_filename=r.get("source_filename", "doc.pdf"),
                source_mime=r.get("source_mime", "application/pdf"),
                has_source_file=True,
                has_preview=False,
                name_check=r.get("name_check", "match"),
                extraction=r.get("extraction", {"engine": "mcp", "model": "local", "duration_ms": 10}),
                fhir_bundle=r.get("fhir_bundle", {}),
                is_sample=r.get("is_sample", False),
                created_at=r.get("created_at", "2026-01-01T00:00:00Z"),
            ))
        except Exception as e:
            logger.debug(f"Record parse note: {e}")

    try:
        answer, citations, model, suggested_questions, format_hint = answer_question(
            query, lang, prof, records, history=None
        )
        return {
            "patient": patient["name"],
            "answer": answer,
            "citations": [c.model_dump() if hasattr(c, "model_dump") else c for c in citations],
            "model_used": model,
            "suggested_followups": suggested_questions,
            "format_hint": format_hint,
            "disclaimer": disclaimer,
        }
    except CopilotUnavailable:
        summary = get_patient_summary_service(patient["name"], owner=owner, allowed_patient_ids=allowed_patient_ids)
        return {
            "patient": patient["name"],
            "answer": f"Here is the verified clinical data for {patient['name']}:\n"
                      f"Diagnoses: {', '.join(summary.get('diagnosed_conditions', [])) or 'None recorded'}\n"
                      f"Active medications: {summary.get('active_medications_count', 0)} prescribed medications on file.\n"
                      f"Recent visits: {len(summary.get('clinical_encounters', []))} consultations recorded.",
            "citations": [],
            "model_used": "grounded_rule_engine",
            "disclaimer": disclaimer,
        }


def find_specialist_doctors_service(specialty_or_condition: str, city: str = "Hyderabad") -> List[Dict[str, Any]]:
    dummy_prof = Profile(id="temp", name="Patient", relation="Self", created_at="2026-01-01T00:00:00Z")
    try:
        doctors = get_doctor_recommendations(
            query=specialty_or_condition,
            records=[],
            profile=dummy_prof,
            language="en",
            city=city,
            lat=None,
            lon=None,
        )
        return [
            {
                "doctor_name": d.name,
                "specialty": d.specialty,
                "hospital": d.hospital_name,
                "rating": d.rating,
                "address": d.address,
                "city": d.city,
                "distance_km": d.distance_km,
                "match_reason": d.reason,
                "booking_contact": d.phone or "Call the hospital reception (number not listed)",
                "timings": d.timings,
                "maps_url": d.maps_url,
            }
            for d in doctors
        ]
    except Exception as e:
        logger.warning(f"Doctor finder unavailable: {e}")
        return [{"error": "Hospital search is not available right now. Please try again, or ask your family doctor for a referral."}]
