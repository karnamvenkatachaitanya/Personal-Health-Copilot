"""Maps an extracted record to an ABDM-aligned FHIR R4 document Bundle.

Profiles follow the NRCES (ndhm) implementation guide:
PrescriptionRecord, DiagnosticReportRecord and DischargeSummaryRecord, each a
Composition-first document bundle. The Patient carries the ABHA number and address
as identifiers. This is a structural mock for testing and demonstration: it is not submitted
to an ABDM gateway and codes use text where no verified SNOMED/LOINC code exists.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.schemas.payloads import ExtractedRecord, Profile
from app.services.regex_cleaner import parse_number, parse_reference_range

NRCES = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/"
SNOMED = "http://snomed.info/sct"

DOC_TYPES = {
    "Prescription": ("PrescriptionRecord", "440545006", "Prescription record"),
    "DiagnosticReport": ("DiagnosticReportRecord", "721981007", "Diagnostic studies report"),
    "DischargeSummary": ("DischargeSummaryRecord", "373942005", "Discharge summary"),
}
INTERP = {"HIGH": ("H", "High"), "LOW": ("L", "Low"), "NORMAL": ("N", "Normal"), "ABNORMAL": ("A", "Abnormal")}


def _uuid() -> str:
    return str(uuid.uuid4())


def _entry(resource: Dict[str, Any]) -> Dict[str, Any]:
    return {"fullUrl": f"urn:uuid:{resource['id']}", "resource": resource}


def _ref(resource: Dict[str, Any]) -> Dict[str, str]:
    return {"reference": f"urn:uuid:{resource['id']}"}


def patient_resource(profile: Profile) -> Dict[str, Any]:
    identifiers = []
    if profile.abha_number:
        identifiers.append({
            "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0203", "code": "MR", "display": "Medical record number"}]},
            "system": "https://healthid.abdm.gov.in", "value": profile.abha_number,
        })
    if profile.abha_address:
        identifiers.append({"system": "https://healthid.abdm.gov.in/address", "value": profile.abha_address})
    res: Dict[str, Any] = {
        "resourceType": "Patient", "id": profile.id, "meta": {"profile": [NRCES + "Patient"]},
        "identifier": identifiers, "name": [{"text": profile.name}],
    }
    if profile.sex in ("M", "F"):
        res["gender"] = "male" if profile.sex == "M" else "female"
    return res


def to_fhir_bundle(rec: ExtractedRecord, profile: Profile, record_id: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    when = rec.record_date or now[:10]
    profile_name, type_code, type_display = DOC_TYPES[rec.record_type]
    patient = patient_resource(profile)
    subject = _ref(patient)
    entries: List[Dict[str, Any]] = [patient]

    author: Optional[Dict[str, Any]] = None
    if rec.doctor_name:
        author = {"resourceType": "Practitioner", "id": _uuid(), "meta": {"profile": [NRCES + "Practitioner"]},
                  "name": [{"text": rec.doctor_name}]}
        entries.append(author)
    org: Optional[Dict[str, Any]] = None
    if rec.facility_name:
        org = {"resourceType": "Organization", "id": _uuid(), "meta": {"profile": [NRCES + "Organization"]},
               "name": rec.facility_name}
        entries.append(org)

    sections: List[Dict[str, Any]] = []

    conditions = []
    for dx in rec.diagnoses:
        c = {"resourceType": "Condition", "id": _uuid(), "meta": {"profile": [NRCES + "Condition"]},
             "code": {"text": dx}, "subject": subject, "recordedDate": when}
        conditions.append(c)
    if conditions:
        entries += conditions
        sections.append({"title": "Diagnoses", "code": {"coding": [{"system": SNOMED, "code": "439401001", "display": "Diagnosis"}]},
                         "entry": [_ref(c) for c in conditions]})

    med_requests = []
    for m in rec.medications:
        dosage_text = " ".join(x for x in [m.frequency, m.timing, f"for {m.duration}" if m.duration else None] if x)
        mr = {"resourceType": "MedicationRequest", "id": _uuid(), "meta": {"profile": [NRCES + "MedicationRequest"]},
              "status": "active", "intent": "order", "subject": subject, "authoredOn": when,
              "medicationCodeableConcept": {"text": " ".join(x for x in [m.form, m.name, m.dosage] if x)},
              "dosageInstruction": [{"text": dosage_text or "As directed"}]}
        if author:
            mr["requester"] = _ref(author)
        if conditions:
            mr["reasonReference"] = [_ref(c) for c in conditions]
        med_requests.append(mr)
    if med_requests:
        entries += med_requests
        sections.append({"title": "Medications", "code": {"coding": [{"system": SNOMED, "code": "721912009", "display": "Medication summary document"}]},
                         "entry": [_ref(m) for m in med_requests]})

    observations = []
    for o in rec.lab_observations:
        obs: Dict[str, Any] = {"resourceType": "Observation", "id": _uuid(), "meta": {"profile": [NRCES + "Observation"]},
                               "status": "final", "code": {"text": o.test_name}, "subject": subject, "effectiveDateTime": when}
        num = parse_number(o.observed_value)
        if num is not None and o.observed_value.replace(",", "").strip().replace(".", "", 1).isdigit():
            obs["valueQuantity"] = {"value": num, "unit": o.unit or ""}
        else:
            obs["valueString"] = o.observed_value
        if o.flag in INTERP:
            code, disp = INTERP[o.flag]
            obs["interpretation"] = [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": code, "display": disp}]}]
        if o.reference_range:
            rr: Dict[str, Any] = {"text": o.reference_range}
            bounds = parse_reference_range(o.reference_range)
            if bounds:
                if bounds[0] is not None:
                    rr["low"] = {"value": bounds[0], "unit": o.unit or ""}
                if bounds[1] is not None:
                    rr["high"] = {"value": bounds[1], "unit": o.unit or ""}
            obs["referenceRange"] = [rr]
        observations.append(obs)
    if observations:
        entries += observations
        if rec.record_type == "DiagnosticReport":
            report = {"resourceType": "DiagnosticReport", "id": _uuid(), "meta": {"profile": [NRCES + "DiagnosticReportLab"]},
                      "status": "final", "code": {"text": "Laboratory report"}, "subject": subject,
                      "effectiveDateTime": when, "issued": now, "result": [_ref(o) for o in observations],
                      "conclusion": rec.summary.english}
            if org:
                report["performer"] = [_ref(org)]
            entries.append(report)
            sections.append({"title": "Laboratory report", "code": {"coding": [{"system": SNOMED, "code": "4241000179101", "display": "Laboratory report"}]},
                             "entry": [_ref(report)]})
        else:
            sections.append({"title": "Investigations", "code": {"coding": [{"system": SNOMED, "code": "721981007", "display": "Diagnostic studies report"}]},
                             "entry": [_ref(o) for o in observations]})

    if rec.record_type == "DischargeSummary" or not sections:
        sections.append({"title": "Summary", "text": {"status": "generated",
                         "div": f"<div xmlns=\"http://www.w3.org/1999/xhtml\">{rec.summary.english}</div>"}})

    composition = {
        "resourceType": "Composition", "id": _uuid(), "meta": {"profile": [NRCES + profile_name]},
        "status": "final", "type": {"coding": [{"system": SNOMED, "code": type_code, "display": type_display}], "text": type_display},
        "subject": subject, "date": f"{when}T00:00:00+05:30" if rec.record_date else now,
        "author": [_ref(author)] if author else [{"display": "Unknown author"}],
        "title": type_display, "section": sections,
    }
    if org:
        composition["custodian"] = _ref(org)

    return {
        "resourceType": "Bundle", "id": record_id,
        "meta": {"lastUpdated": now, "profile": [NRCES + "DocumentBundle"]},
        "identifier": {"system": "https://health-copilot.local/bundles", "value": record_id},
        "type": "document", "timestamp": now,
        "entry": [_entry(composition)] + [_entry(e) for e in entries],
    }


def profile_collection(profile: Profile, bundles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """All of one person's document bundles as a FHIR collection, for export."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"resourceType": "Bundle", "id": _uuid(), "type": "collection", "timestamp": now,
            "meta": {"lastUpdated": now},
            "entry": [_entry(patient_resource(profile))] + [{"fullUrl": f"urn:uuid:{b['id']}", "resource": b} for b in bundles]}
