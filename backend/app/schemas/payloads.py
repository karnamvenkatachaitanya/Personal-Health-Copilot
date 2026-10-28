from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

RecordType = Literal["Prescription", "DiagnosticReport", "DischargeSummary"]
Flag = Literal["NORMAL", "HIGH", "LOW", "ABNORMAL", "UNKNOWN"]
Lang = Literal["en", "hi", "te"]


class Localized(BaseModel):
    """The same text in the three supported languages. Hindi/Telugu may be missing."""
    english: str
    hindi: Optional[str] = None
    telugu: Optional[str] = None


class LocalizedList(BaseModel):
    english: List[str] = Field(default_factory=list)
    hindi: List[str] = Field(default_factory=list)
    telugu: List[str] = Field(default_factory=list)


class MedicationItem(BaseModel):
    name: str
    form: Optional[str] = None
    dosage: str = ""
    frequency: str = ""
    timing: Optional[str] = None
    duration: Optional[str] = None
    instructions: Optional[Localized] = None
    uncertain: bool = False
    source_box: Optional[List[int]] = None  # [ymin, xmin, ymax, xmax] on a 0-1000 grid of the page image


class LabObservationItem(BaseModel):
    test_name: str
    observed_value: str
    unit: Optional[str] = ""
    reference_range: Optional[str] = None
    flag: Flag = "UNKNOWN"
    flag_source: Literal["computed", "document", "ai"] = "ai"
    explanation: Optional[Localized] = None
    uncertain: bool = False
    source_box: Optional[List[int]] = None  # [ymin, xmin, ymax, xmax] on a 0-1000 grid of the page image


class ExtractedRecord(BaseModel):
    record_type: RecordType
    record_date: Optional[str] = None
    patient_name: Optional[str] = None
    patient_age: Optional[str] = None
    patient_sex: Optional[str] = None
    doctor_name: Optional[str] = None
    facility_name: Optional[str] = None
    diagnoses: List[str] = Field(default_factory=list)
    medications: List[MedicationItem] = Field(default_factory=list)
    lab_observations: List[LabObservationItem] = Field(default_factory=list)
    summary: Localized
    doctor_questions: LocalizedList = Field(default_factory=LocalizedList)
    follow_up: Optional[str] = None
    handwritten: bool = False
    languages_detected: List[str] = Field(default_factory=list)
    unreadable_parts: List[str] = Field(default_factory=list)


class ExtractionMeta(BaseModel):
    engine: str
    model: str
    duration_ms: int
    warnings: List[str] = Field(default_factory=list)


class Profile(BaseModel):
    id: str
    name: str
    relation: str = "Self"
    age: Optional[str] = None
    sex: Optional[str] = None
    abha_number: Optional[str] = None
    abha_address: Optional[str] = None
    abha_linked: bool = False
    abha_linked_at: Optional[str] = None
    is_sample: bool = False
    created_at: str


class ProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    relation: str = Field("Family member", max_length=40)
    age: Optional[str] = None
    sex: Optional[str] = None


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    relation: Optional[str] = Field(None, max_length=40)
    age: Optional[str] = None
    sex: Optional[str] = None


class HealthRecord(BaseModel):
    id: str
    profile_id: str
    document_type: RecordType
    record_date: Optional[str] = None
    title: str
    extracted: ExtractedRecord
    source_filename: str
    source_mime: str
    has_source_file: bool = True
    has_preview: bool = False
    name_check: Literal["match", "mismatch", "missing"] = "missing"
    extraction: ExtractionMeta
    fhir_bundle: Dict[str, Any]
    is_sample: bool = False
    created_at: str


class RecordMove(BaseModel):
    profile_id: str


class ABHALinkRequest(BaseModel):
    abha_number: Optional[str] = Field(None, examples=["91-1234-5678-9012"])
    abha_address: Optional[str] = Field(None, examples=["lakshmi.devi@abdm"])


class DoctorRecommendation(BaseModel):
    name: str
    specialty: str
    hospital_name: str
    address: str
    city: str
    distance_km: Optional[float] = None
    rating: Optional[float] = None
    maps_url: str
    phone: Optional[str] = None
    reason: str
    timings: Optional[str] = None


class DoctorSearchRequest(BaseModel):
    profile_id: str
    query: Optional[str] = None
    specialty: Optional[str] = None
    city: Optional[str] = "Hyderabad"
    lat: Optional[float] = None
    lon: Optional[float] = None
    language: Lang = "en"


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class CopilotQueryRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    language: Lang = "en"
    profile_id: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    city: Optional[str] = Field(None, max_length=60)
    history: Optional[List[ConversationTurn]] = Field(None, max_length=12)


class Citation(BaseModel):
    record_id: str
    title: str
    record_date: Optional[str] = None


class CopilotQueryResponse(BaseModel):
    answer: str
    language: Lang
    citations: List[Citation] = Field(default_factory=list)
    disclaimer: str
    safety: Literal["ok", "crisis"] = "ok"
    model: str
    doctors: List[DoctorRecommendation] = Field(default_factory=list)
    suggested_questions: List[str] = Field(default_factory=list)
    format_hint: Optional[str] = "adaptive"

