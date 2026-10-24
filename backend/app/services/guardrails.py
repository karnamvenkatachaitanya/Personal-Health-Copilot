"""Safety rules for the copilot.

The crisis screen is deterministic and always runs before any model call, so
self-harm or overdose questions get emergency numbers even if every AI service is down.
The scope screen keeps the copilot to health: requests for code are declined before the
model is called, and an answer that still contains code is replaced before it is shown.
"""
import re
from typing import Optional

CRISIS_PATTERNS = [
    r"\b(suicide|suicidal|kill (myself|me)|end my life|want to die|self[- ]harm)\b",
    r"\b(overdose|take all (the|my) (tablets|pills|medicines))\b",
    r"\b(poison(ing)?|lethal dose)\b",
    r"आत्महत्या", r"मरना चाहता", r"मरना चाहती", r"ఆత్మహత్య", r"చనిపోవాలని",
]
EMERGENCY_SIGNS = [
    r"\b(chest pain|can'?t breathe|cannot breathe|unconscious|fainted|stroke|seizure|heavy bleeding)\b",
    r"सीने में दर्द", r"सांस नहीं", r"ఛాతీ నొప్పి", r"ఊపిరి ఆడటం లేదు",
]

CRISIS_REPLY = {
    "en": "This sounds serious and you deserve help right now. Please call 112 (emergency) or Tele-MANAS on 14416 (free, 24x7 mental health support), or go to the nearest hospital. If someone may have taken too many medicines, go to the emergency department now and take the medicine strips with you.",
    "hi": "यह गंभीर लग रहा है और आपको अभी मदद मिलनी चाहिए। कृपया 112 (आपातकाल) या टेली-मानस 14416 (मुफ्त, 24 घंटे मानसिक स्वास्थ्य सहायता) पर कॉल करें, या नज़दीकी अस्पताल जाएं। अगर किसी ने ज़्यादा दवा ले ली है तो दवा के पत्ते साथ लेकर तुरंत इमरजेंसी जाएं।",
    "te": "ఇది తీవ్రమైన విషయంలా ఉంది, మీకు వెంటనే సహాయం అందాలి. దయచేసి 112 (అత్యవసరం) లేదా టెలి-మానస్ 14416 (ఉచితం, 24 గంటల మానసిక ఆరోగ్య సహాయం)కి కాల్ చేయండి, లేదా దగ్గరలోని ఆసుపత్రికి వెళ్ళండి. ఎవరైనా ఎక్కువ మందులు వేసుకుంటే, మందుల స్ట్రిప్‌లు తీసుకుని వెంటనే ఎమర్జెన్సీకి వెళ్ళండి.",
}
EMERGENCY_REPLY = {
    "en": "These can be signs of an emergency. Please call 112 or 108 for an ambulance, or go to the nearest emergency department now. Do not wait for an app.",
    "hi": "ये आपातकाल के लक्षण हो सकते हैं। कृपया एम्बुलेंस के लिए 112 या 108 पर कॉल करें या तुरंत नज़दीकी इमरजेंसी जाएं।",
    "te": "ఇవి అత్యవసర లక్షణాలు కావచ్చు. దయచేసి అంబులెన్స్ కోసం 112 లేదా 108కి కాల్ చేయండి, లేదా వెంటనే దగ్గరలోని ఎమర్జెన్సీకి వెళ్ళండి.",
}

# Asking for code. Kept narrow so health questions ("kidney function", "ICD code",
# "does iron react with calcium") are never caught; the prompt and the output check cover the rest.
CODE_REQUEST = re.compile(
    r"\b(python|javascript|typescript|java|c\+\+|c#|golang|php|html|css|sql|bash|powershell|kotlin)\b"
    r"|\b(coding|programming)\b"
    r"|\b(write|generate|debug|fix)\b.{0,30}\b(code|script|program|snippet|algorithm)\b",
    re.I,
)
# Code in an answer: fenced blocks, or lines that start like source code. Case-sensitive on purpose.
CODE_OUTPUT = re.compile(
    r"```|^\s*(def \w+\(|class \w+[:(]|import \w|from [\w.]+ import |#include|public (static|class) |"
    r"function \w*\s*\(|const \w+ = |console\.log|print\(|SELECT .+ FROM |<script|<\?php)",
    re.M,
)

OFF_TOPIC_REPLY = {
    "en": "I can only help with your family's health: reports, medicines, reminders and doctor visits. I can't help with writing code or other topics.",
    "hi": "मैं केवल आपके परिवार के स्वास्थ्य में मदद कर सकता हूँ: रिपोर्ट, दवाइयाँ, रिमाइंडर और डॉक्टर की मुलाक़ात। कोड लिखने या दूसरे विषयों में मैं मदद नहीं कर सकता।",
    "te": "నేను మీ కుటుంబ ఆరోగ్యం గురించి మాత్రమే సహాయం చేయగలను: రిపోర్టులు, మందులు, రిమైండర్లు, డాక్టర్ సందర్శనలు. కోడ్ రాయడం లేదా ఇతర విషయాల్లో సహాయం చేయలేను.",
}

DISCLAIMER = {
    "en": "Explains your documents in plain words. It is not a diagnosis. Please check with your doctor before changing any medicine.",
    "hi": "यह आपके दस्तावेज़ों को आसान शब्दों में समझाता है। यह निदान नहीं है। कोई भी दवा बदलने से पहले अपने डॉक्टर से पूछें।",
    "te": "ఇది మీ పత్రాలను సులభమైన మాటల్లో వివరిస్తుంది. ఇది వైద్య నిర్ధారణ కాదు. ఏ మందు మార్చే ముందైనా మీ డాక్టర్‌ను అడగండి.",
}


def crisis_reply(text: str, language: str) -> Optional[str]:
    t = text.lower()
    if any(re.search(p, t) for p in CRISIS_PATTERNS):
        return CRISIS_REPLY.get(language, CRISIS_REPLY["en"])
    if any(re.search(p, t) for p in EMERGENCY_SIGNS):
        return EMERGENCY_REPLY.get(language, EMERGENCY_REPLY["en"])
    return None


def asks_for_code(text: str) -> bool:
    return bool(CODE_REQUEST.search(text))


def contains_code(answer: str) -> bool:
    return bool(CODE_OUTPUT.search(answer))


def off_topic_reply(language: str) -> str:
    return OFF_TOPIC_REPLY.get(language, OFF_TOPIC_REPLY["en"])
