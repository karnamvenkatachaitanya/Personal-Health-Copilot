"""Which specialist department to see, at real nearby hospitals.

Hospitals come from OpenStreetMap Nominatim; the specialty is chosen from the patient's own
records and question. No doctor names, ratings or phone numbers are invented.
"""
import logging
import math
import re
from typing import List, Optional, Tuple
import httpx

from app.schemas.payloads import DoctorRecommendation, HealthRecord, Profile

logger = logging.getLogger(__name__)

# Specialty mapping based on clinical keywords
THYROID_RULE = {
    "keywords": ["thyroid", "tsh", "hypothyroid", "hyperthyroid", "levothyroxine", "thyroxine", "thyronorm", "eltroxin", "t3", "t4"],
    "specialty": "Endocrinology & Diabetology",
    "doctor_title": "Endocrinologist",
    "reasons": {
        "en": "Endocrinologists treat thyroid and other hormone conditions, and review thyroid test results and tablet doses.",
        "hi": "एंडोक्रिनोलॉजिस्ट थायरॉइड और अन्य हार्मोन संबंधी समस्याओं का इलाज करते हैं और थायरॉइड रिपोर्ट व दवा की खुराक देखते हैं।",
        "te": "ఎండోక్రినాలజిస్టులు థైరాయిడ్ మరియు ఇతర హార్మోన్ సమస్యలకు చికిత్స చేస్తారు, థైరాయిడ్ రిపోర్టులు, మాత్రల మోతాదు చూస్తారు."
    }
}

SPECIALTY_RULES = [
    {
        "keywords": ["diabetes", "sugar", "hba1c", "glucose", "fbs", "ppbs", "insulin", "glycomet", "metformin", "endocrine"],
        "specialty": "Endocrinology & Diabetology",
        "doctor_title": "Senior Consultant Diabetologist & Endocrinologist",
        "reasons": {
            "en": "Specialized in blood sugar optimization, insulin management, and preventing diabetic complications.",
            "hi": "रक्त शर्करा नियंत्रण, इंसुलिन प्रबंधन और मधुमेह संबंधी जटिलताओं की रोकथाम में विशेषज्ञ।",
            "te": "రక్తంలో చక్కెర నియంత్రణ, ఇన్సులిన్ నిర్వహణ మరియు డయాబెటిస్ సమస్యల నివారణలో నిపుణులు."
        }
    },
    {
        "keywords": ["heart", "cardiac", "chest", "bp", "hypertension", "ecg", "troponin", "cholesterol", "lipid", "telma", "atorvastatin"],
        "specialty": "Cardiology",
        "doctor_title": "Senior Interventional Cardiologist",
        "reasons": {
            "en": "Expert care for blood pressure management, cardiac screening, and cardiovascular health.",
            "hi": "रक्तचाप नियंत्रण, हृदय जांच और हृदय स्वास्थ्य के लिए विशेषज्ञ परामर्श।",
            "te": "రక్తపోటు నియంత్రణ, గుండె పరీక్షలు మరియు హృద్రోగ సంరక్షణలో నిపుణులు."
        }
    },
    {
        "keywords": ["appendicitis", "abdomen", "stomach", "gastric", "ulcer", "liver", "lft", "bilirubin", "sgot", "sgpt", "pancreas"],
        "specialty": "Gastroenterology & General Surgery",
        "doctor_title": "Consultant Surgical Gastroenterologist",
        "reasons": {
            "en": "Specialized in abdominal pain, post-surgical recovery, and digestive system evaluation.",
            "hi": "पेट दर्द, सर्जरी के बाद की देखभाल और पाचन तंत्र की जांच में विशेषज्ञ।",
            "te": "కడుపు నొప్పి, శస్త్రచికిత్స అనంతర రికవరీ మరియు జీర్ణకోశ సమస్యల నిపుణులు."
        }
    },
    {
        "keywords": ["kidney", "renal", "creatinine", "urea", "bun", "uric acid", "urine", "egfr"],
        "specialty": "Nephrology",
        "doctor_title": "Consultant Nephrologist & Renal Specialist",
        "reasons": {
            "en": "Expert monitoring for renal function parameters, fluid balance, and kidney health.",
            "hi": "गुर्दे की कार्यप्रणाली, क्रिएटिनिन निगरानी और नेफ्रोलॉजी परामर्श में विशेषज्ञ।",
            "te": "కిడ్నీ పనితీరు పరీక్షలు, క్రియాటినిన్ పర్యవేక్షణ మరియు మూత్రపిండాల సంరక్షణ నిపుణులు."
        }
    },
    {
        "keywords": ["cough", "fever", "wbc", "crp", "infection", "antibiotic", "cefuroxime", "paracetamol", "general"],
        "specialty": "Internal Medicine / General Physician",
        "doctor_title": "Senior Consultant Physician",
        "reasons": {
            "en": "Comprehensive clinical evaluation for acute infection, elevated inflammatory markers, and general health review.",
            "hi": "तीव्र संक्रमण, उच्च सूजन मार्करों और समग्र स्वास्थ्य मूल्यांकन के लिए विशेषज्ञ।",
            "te": "తీవ్రమైన ఇన్ఫెక్షన్లు, పెరిగిన వాపు మార్కర్లు మరియు సమగ్ర ఆరోగ్య పరీక్షల నిపుణులు."
        }
    }
]

# No named doctors are suggested: we have no verified roster, so inventing names, ratings or phone
# numbers would mislead a patient. We recommend the right department at a real (OpenStreetMap) hospital,
# and name a doctor only when the family's own records show one at that hospital.


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 1)


DOCTOR_WORDS = re.compile(
    r"\b(doctor|doctors|hospital|hospitals|clinic|specialist|consult|consultation|appointment|physician|surgeon|opd"
    r"|near me|nearby|whom should i see|who should i see|where should i go)\b"
    r"|డాక్టర్|ఆసుపత్రి|వైద్యుడు|కన్సల్ట్|डॉक्टर|अस्पताल|चिकित्सक",
    re.IGNORECASE,
)


def is_doctor_query(query: str) -> bool:
    """True only for questions about seeing a doctor. Whole words, so "drug", "address" or
    "reference range" do not trigger a hospital search."""
    return bool(DOCTOR_WORDS.search(query or ""))


SPECIALTY_NAMES = {
    "Endocrinology & Diabetology": ["endocrinology", "endocrinologist", "diabetologist", "diabetology", "thyroid"],
    "Cardiology": ["cardiology", "cardiologist", "heart specialist"],
    "Nephrology": ["nephrology", "nephrologist", "kidney specialist"],
    "Gastroenterology & General Surgery": ["gastroenterology", "gastroenterologist", "gastro", "surgeon", "surgery"],
}


def _match_rule(text: str) -> Optional[dict]:
    t = (text or "").lower()
    for rule in [THYROID_RULE] + SPECIALTY_RULES:
        names = SPECIALTY_NAMES.get(rule["specialty"], [])
        if any(re.search(rf"\b{re.escape(w)}\b", t) for w in names + rule["keywords"]):
            return rule
    return None


def detect_specialty(query: str, records: List[HealthRecord]) -> dict:
    """The question decides first ("I have fever" means a physician even for a diabetic);
    the person's records are used only when the question names no specialty or condition."""
    rule = _match_rule(query)
    if rule:
        return rule
    combined = " ".join(
        " ".join(r.extracted.diagnoses) + " " + " ".join(m.name for m in r.extracted.medications) + " "
        + " ".join(o.test_name for o in r.extracted.lab_observations)
        for r in records
    )
    return _match_rule(combined) or SPECIALTY_RULES[-1]


def _fetch_real_hospitals_uncached(city: str, lat: Optional[float] = None, lon: Optional[float] = None, limit: int = 5) -> List[dict]:
    """Queries OpenStreetMap Nominatim in real-time for authentic hospitals."""
    headers = {"User-Agent": "PersonalHealthCopilot/2.0 (production-health-copilot)"}
    hospitals = []
    
    # Try Nominatim location search
    try:
        if lat is not None and lon is not None:
            delta = 0.08
            params = {
                "format": "json",
                "q": "hospital",
                "viewbox": f"{lon-delta},{lat+delta},{lon+delta},{lat-delta}",
                "bounded": 1,
                "limit": limit
            }
        else:
            params = {
                "format": "json",
                "q": f"hospital in {city}",
                "limit": limit
            }
        
        with httpx.Client(timeout=4.5) as client:
            resp = client.get("https://nominatim.openstreetmap.org/search", params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                for item in data:
                    raw_name = item.get("display_name", "")
                    parts = [p.strip() for p in raw_name.split(",") if p.strip()]
                    h_name = parts[0] if parts else "Multi-Speciality Hospital"
                    h_lat = float(item["lat"])
                    h_lon = float(item["lon"])
                    
                    dist = haversine_km(lat, lon, h_lat, h_lon) if (lat and lon) else None
                    address_str = ", ".join(parts[1:4]) if len(parts) > 1 else city
                    
                    # Loose OSM tags sometimes return a road name; skip it rather than invent a hospital name.
                    if any(bad in h_name.lower() for bad in ["road", "street", "lane", "colony"]):
                        continue
                    
                    hospitals.append({
                        "hospital_name": h_name,
                        "address": address_str,
                        "city": city,
                        "lat": h_lat,
                        "lon": h_lon,
                        "distance_km": dist,
                        "maps_url": f"https://www.google.com/maps/search/?api=1&query={h_name.replace(' ', '+')}+{city.replace(' ', '+')}"
                    })
    except Exception as e:
        logger.warning(f"Live Nominatim fetch failed ({e}), using verified local hospital fallback")
    
    # Fallback when the live search fails: a short list of large hospitals, only for the cities
    # it covers, and with distance shown only when we know where the user is.
    if not hospitals:
        city_lower = (city or "hyderabad").lower()
        if "tirupati" in city_lower:
            fallback_city, verified = "Tirupati", [
                ("SVIMS Super Speciality Hospital", "Alipiri Road, Tirupati", 13.6373, 79.4065),
                ("Apollo Hospitals", "Old PB Road, Renigunta, Tirupati", 13.6401, 79.4350),
                ("Amara Hospital", "Karakambadi Road, Tirupati", 13.6620, 79.4600),
            ]
        elif "bangalore" in city_lower or "bengaluru" in city_lower:
            fallback_city, verified = "Bengaluru", [
                ("Manipal Hospital", "Old Airport Road, Kodihalli, Bengaluru", 12.9592, 77.6499),
                ("Apollo Hospitals", "Bannerghatta Main Road, Bengaluru", 12.8941, 77.5986),
                ("Fortis Hospital", "Cunningham Road, Vasanth Nagar, Bengaluru", 12.9881, 77.5934),
            ]
        elif "hyderabad" in city_lower or "secunderabad" in city_lower:
            fallback_city, verified = "Hyderabad", [
                ("Apollo Hospitals", "Road No 72, Film Nagar, Jubilee Hills, Hyderabad", 17.4168, 78.4116),
                ("KIMS Hospitals", "1-8-31/1, Minister Road, Krishna Nagar Colony, Secunderabad", 17.4359, 78.4871),
                ("CARE Hospitals", "Road No 1, Banjara Hills, Hyderabad", 17.4156, 78.4487),
                ("Yashoda Hospitals", "Raj Bhavan Road, Somajiguda, Hyderabad", 17.4265, 78.4589),
            ]
        else:
            return []  # never show another city's hospitals under this city's name
        for name, addr, h_lat, h_lon in verified[:limit]:
            hospitals.append({
                "hospital_name": name,
                "address": addr,
                "city": fallback_city,
                "lat": h_lat,
                "lon": h_lon,
                "distance_km": haversine_km(lat, lon, h_lat, h_lon) if (lat and lon) else None,
                "maps_url": f"https://www.google.com/maps/search/?api=1&query={name.replace(' ', '+')}+{fallback_city}"
            })

    return hospitals[:limit]


_HOSPITAL_CACHE: dict = {}
_CACHE_SECONDS = 3600


def fetch_real_hospitals(city: str, lat: Optional[float] = None, lon: Optional[float] = None, limit: int = 5) -> List[dict]:
    """OpenStreetMap search with a one-hour cache, so repeated questions do not hit the public service."""
    import time
    key = ((city or "").strip().lower(), round(lat, 2) if lat else None, round(lon, 2) if lon else None, limit)
    hit = _HOSPITAL_CACHE.get(key)
    if hit and time.time() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    result = _fetch_real_hospitals_uncached(city=city, lat=lat, lon=lon, limit=limit + 3)
    _HOSPITAL_CACHE[key] = (time.time(), result)
    return result


KNOWN_CITIES = ["Hyderabad", "Secunderabad", "Tirupati", "Bengaluru", "Bangalore", "Vijayawada", "Visakhapatnam", "Chennai", "Mumbai", "Delhi", "Pune", "Warangal", "Guntur", "Nellore"]


def city_from_records(records: List[HealthRecord]) -> Optional[str]:
    """The city printed on the person's most recent clinic or lab document, if any."""
    for r in sorted(records, key=lambda r: r.record_date or "", reverse=True):
        place = f"{r.extracted.facility_name or ''} {r.title or ''}"
        for c in KNOWN_CITIES:
            if c.lower() in place.lower():
                return "Bengaluru" if c == "Bangalore" else c
    return None


def get_doctor_recommendations(
    query: str,
    records: List[HealthRecord],
    profile: Profile,
    language: str = "en",
    city: str = "Hyderabad",
    lat: Optional[float] = None,
    lon: Optional[float] = None
) -> List[DoctorRecommendation]:
    """Generates grounded, real-time doctor & hospital recommendations."""
    rule = detect_specialty(query, records)
    specialty = rule["specialty"]
    reason_text = rule["reasons"].get(language, rule["reasons"]["en"])
    
    # Tailor reason to patient
    if profile and profile.name:
        if language == "te":
            prefix = f"{profile.name} గారికి "
        elif language == "hi":
            prefix = f"{profile.name} के लिए "
        else:
            prefix = f"Recommended for {profile.name}: "
        reason_text = prefix + reason_text

    hospitals = fetch_real_hospitals(city=city, lat=lat, lon=lon, limit=3)
    if "oncolog" not in specialty.lower():
        # A cancer centre is the wrong place to send a thyroid or heart question.
        hospitals = [h for h in hospitals if not re.search(r"cancer|oncolog", h["hospital_name"], re.I)]
    hospitals = hospitals[:3]
    recommendations: List[DoctorRecommendation] = []
    for h in hospitals:
        name = f"{specialty} department"
        for r in records:
            if r.extracted.doctor_name and r.extracted.facility_name and h["hospital_name"].lower() in r.extracted.facility_name.lower():
                name = f"{r.extracted.doctor_name} (your doctor here)"
                break

        rec = DoctorRecommendation(
            name=name,
            specialty=specialty,
            hospital_name=h["hospital_name"],
            address=h["address"],
            city=h["city"],
            distance_km=h["distance_km"],
            rating=None,
            maps_url=h["maps_url"],
            phone=h.get("phone"),
            reason=reason_text,
            timings=None,
        )
        recommendations.append(rec)
        
    return recommendations
