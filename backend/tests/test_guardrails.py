import pytest

from app.services.guardrails import CRISIS_REPLY, DISCLAIMER, EMERGENCY_REPLY, OFF_TOPIC_REPLY, asks_for_code, contains_code, crisis_reply


@pytest.mark.parametrize("text,lang", [
    ("I want to end my life", "en"), ("what if I take all my tablets at once", "en"),
    ("मैं आत्महत्या करना चाहता हूँ", "hi"), ("నాకు ఆత్మహత్య చేసుకోవాలని ఉంది", "te"),
])
def test_crisis_questions_get_helplines_in_their_language(text, lang):
    reply = crisis_reply(text, lang)
    assert reply == CRISIS_REPLY[lang]
    assert "14416" in reply and "112" in reply


@pytest.mark.parametrize("text,lang", [
    ("my father has chest pain right now", "en"), ("सीने में दर्द हो रहा है", "hi"), ("నాన్నకు ఛాతీ నొప్పి", "te"),
])
def test_emergency_signs_send_people_to_108(text, lang):
    reply = crisis_reply(text, lang)
    assert reply == EMERGENCY_REPLY[lang] and "108" in reply


@pytest.mark.parametrize("text", [
    "When should Lakshmi take her thyroid tablet?", "Is her haemoglobin improving?", "What is CRP?",
])
def test_ordinary_questions_pass_through(text):
    assert crisis_reply(text, "en") is None


def test_every_language_has_a_disclaimer():
    assert set(DISCLAIMER) == {"en", "hi", "te"}


@pytest.mark.parametrize("text", [
    "Write a Python function to reverse a string", "give me javascript for a todo app",
    "can you debug this code for me", "help me with SQL joins", "teach me programming",
])
def test_code_requests_are_declined_before_the_model(text):
    assert asks_for_code(text)


@pytest.mark.parametrize("text", [
    "What is her kidney function?", "Does iron react with calcium?", "Show me the ICD code for her diagnosis",
    "Give her a diet program for diabetes", "When should she take the thyroid tablet?", "లక్ష్మి గారి TSH ఎలా ఉంది?",
])
def test_health_questions_are_not_mistaken_for_code(text):
    assert not asks_for_code(text)


def test_code_in_an_answer_is_detected():
    assert contains_code("Sure:\n```python\nprint('hi')\n```")
    assert contains_code("Here you go:\ndef reverse(s):\n    return s[::-1]")
    assert not contains_code("| Date | Test | Value |\n|---|---|---|\n- [ ] Ask about HbA1c\n> ⚠️ **Note:** Select a time from the list.")


def test_every_language_has_a_scope_reply():
    assert set(OFF_TOPIC_REPLY) == {"en", "hi", "te"}
