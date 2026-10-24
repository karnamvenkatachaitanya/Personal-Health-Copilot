"""Care plan API: reminders, follow-ups, preventive next steps, and what the agent did."""
import asyncio
import re
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services import care_store, store
from app.services.auth import current_user_id
from app.services.care_plan import doses_for_day, risk_insights, visit_questions

try:
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
except Exception:
    IST = timezone(timedelta(hours=5, minutes=30))
router = APIRouter(tags=["Care plan"])
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _today(day: Optional[str]) -> date:
    if day:
        try:
            return date.fromisoformat(day)
        except ValueError:
            raise HTTPException(422, "date must be YYYY-MM-DD")
    return datetime.now(IST).date()


def _profile_or_404(owner: str, profile_id: UUID):
    p = store.get_profile(owner, str(profile_id))
    if not p:
        raise HTTPException(404, "Profile not found")
    return p


@router.get("/profiles/{profile_id}/care-plan")
async def care_plan(profile_id: UUID, day: Optional[str] = Query(None, alias="date"), owner: str = Depends(current_user_id)):
    """Runs the agent for this person, then returns the plan for `date` (the user's local day)."""
    today = _today(day)
    await asyncio.to_thread(_profile_or_404, owner, profile_id)
    pid = str(profile_id)
    records = await asyncio.to_thread(store.list_records, owner, pid)
    persisted = True
    try:
        agent = await asyncio.to_thread(care_store.sync, owner, pid, today)
        items = await asyncio.to_thread(care_store.list_items, owner, pid)
        meds = [i for i in items if i["kind"] == "medicine"]
        logs = await asyncio.to_thread(care_store.logs_for, owner, [i["id"] for i in meds], today - timedelta(days=8))
    except Exception as e:  # noqa: BLE001 - care tables not migrated yet: compute the plan live, read-only
        if not care_store.is_missing_table(e):
            raise
        persisted, agent, logs = False, {"created": [], "closed": []}, []
        items = care_store.ephemeral_items(pid, records, today)
        meds = [i for i in items if i["kind"] == "medicine"]
    insights = risk_insights(records)
    return {
        "date": today.isoformat(),
        "persisted": persisted,
        "items": items,
        "doses": doses_for_day(items, logs, today),
        "insights": insights,
        "visit_questions": visit_questions(records, items, insights, today),
        "adherence": care_store.adherence(meds, logs, today),
        "agent": agent,
    }


@router.get("/care-plan/today")
async def family_today(day: Optional[str] = Query(None, alias="date"), owner: str = Depends(current_user_id)):
    """Today's doses and overdue items for the whole family, for in-app notifications."""
    today = _today(day)
    try:
        items = await asyncio.to_thread(care_store.list_items, owner, None)
        meds = [i for i in items if i["kind"] == "medicine"]
        logs = await asyncio.to_thread(care_store.logs_for, owner, [i["id"] for i in meds], today - timedelta(days=1))
    except Exception as e:  # noqa: BLE001
        if not care_store.is_missing_table(e):
            raise
        return {"date": today.isoformat(), "doses": [], "overdue": [], "persisted": False}
    overdue = [i for i in items if i["kind"] != "medicine" and i["status"] == "active"
               and i.get("due_date") and i["due_date"] < today.isoformat()]
    return {"date": today.isoformat(), "doses": doses_for_day(items, logs, today),
            "overdue": [{"id": i["id"], "patient_id": i["patient_id"], "title": i["title"], "kind": i["kind"],
                         "due_date": i["due_date"]} for i in overdue]}


class CareItemCreate(BaseModel):
    kind: Literal["medicine", "appointment", "repeat_test"]
    title: str = Field(..., min_length=1, max_length=120)
    detail: Optional[str] = Field(None, max_length=120)
    schedule: Optional[Literal["daily", "weekly", "as_needed", "once"]] = None
    times: List[str] = Field(default_factory=list, max_length=6)
    weekday: Optional[int] = Field(None, ge=0, le=6)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    due_date: Optional[date] = None


class CareItemPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=120)
    detail: Optional[str] = Field(None, max_length=120)
    times: Optional[List[str]] = Field(None, max_length=6)
    weekday: Optional[int] = Field(None, ge=0, le=6)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    due_date: Optional[date] = None
    status: Optional[Literal["active", "paused", "done", "dismissed"]] = None
    reviewed: Optional[bool] = None


def _check_times(times: Optional[List[str]]) -> None:
    for t in times or []:
        if not TIME.match(t):
            raise HTTPException(422, f"Time {t!r} must be HH:MM (24-hour).")


def _jsonable(d: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in d.items()}


@router.post("/profiles/{profile_id}/care-items", status_code=201)
async def add_item(profile_id: UUID, body: CareItemCreate, owner: str = Depends(current_user_id)):
    await asyncio.to_thread(_profile_or_404, owner, profile_id)
    _check_times(body.times)
    fields = _jsonable(body.model_dump())
    if body.kind == "medicine":
        fields["schedule"] = fields.get("schedule") or "daily"
    else:
        fields["schedule"] = "once"
        if not body.due_date:
            raise HTTPException(422, "Choose a date for the visit or test.")
    return await asyncio.to_thread(care_store.add_item, owner, str(profile_id), fields)


@router.patch("/care-items/{item_id}")
async def edit_item(item_id: UUID, body: CareItemPatch, owner: str = Depends(current_user_id)):
    _check_times(body.times)
    changes = _jsonable(body.model_dump(exclude_unset=True))
    if changes:
        changes.setdefault("reviewed", True)  # touching an agent item counts as reviewing it
    row = await asyncio.to_thread(care_store.update_item, owner, str(item_id), changes)
    if not row:
        raise HTTPException(404, "Reminder not found")
    return row


class LogBody(BaseModel):
    action: Literal["taken", "skipped", "snoozed", "done", "reopened"]
    dose_date: Optional[date] = None
    dose_time: Optional[str] = None
    snooze_minutes: int = Field(15, ge=5, le=240)


@router.post("/care-items/{item_id}/log", status_code=201)
async def log_action(item_id: UUID, body: LogBody, owner: str = Depends(current_user_id)):
    item = await asyncio.to_thread(care_store.get_item, owner, str(item_id))
    if not item:
        raise HTTPException(404, "Reminder not found")
    _check_times([body.dose_time] if body.dose_time else [])
    until = None
    if body.action == "snoozed":
        until = (datetime.now(timezone.utc) + timedelta(minutes=body.snooze_minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
    row = await asyncio.to_thread(care_store.log, owner, str(item_id), body.action,
                                  body.dose_date.isoformat() if body.dose_date else None, body.dose_time, until)
    if body.action in ("done", "reopened") and item["kind"] != "medicine":
        await asyncio.to_thread(care_store.update_item, owner, str(item_id),
                                {"status": "done" if body.action == "done" else "active", "reviewed": True})
    return row


# ---------------------------------------------------------------------------
# Calendar export: the phone's own calendar fires the alarms, even with the app closed.
# ---------------------------------------------------------------------------

ICS_TEXT = {
    "en": {"med": "Take {name}", "test": "Repeat test: {name}", "visit": "Follow-up visit: {name}",
           "overdue": "Overdue", "note": "Set up by Health Copilot from your records. Check timings with your doctor."},
    "hi": {"med": "{name} लें", "test": "दोबारा जांच: {name}", "visit": "फ़ॉलो-अप विज़िट: {name}",
           "overdue": "समय निकल गया", "note": "आपके रिकॉर्ड से Health Copilot ने बनाया। समय अपने डॉक्टर से पक्का करें।"},
    "te": {"med": "{name} వేసుకోండి", "test": "మళ్ళీ పరీక్ష: {name}", "visit": "ఫాలో-అప్ విజిట్: {name}",
           "overdue": "గడువు దాటింది", "note": "మీ రికార్డుల నుండి Health Copilot తయారు చేసింది. సమయాలను మీ డాక్టర్‌తో నిర్ధారించుకోండి."},
}


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ics(items: List[dict], name: str, lang: str, today: date) -> str:
    tx = ICS_TEXT.get(lang, ICS_TEXT["en"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Health Copilot//Care plan//EN", "CALSCALE:GREGORIAN",
           f"X-WR-CALNAME:{_esc(name)} - Health Copilot",
           "BEGIN:VTIMEZONE", "TZID:Asia/Kolkata", "BEGIN:STANDARD", "DTSTART:19700101T000000",
           "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "TZNAME:IST", "END:STANDARD", "END:VTIMEZONE"]

    def event(uid: str, start: str, summary: str, rrule: Optional[str] = None, alarm_min: int = 0):
        out.extend(["BEGIN:VEVENT", f"UID:{uid}@health-copilot", f"DTSTAMP:{stamp}",
                    f"DTSTART;TZID=Asia/Kolkata:{start}", f"SUMMARY:{_esc(summary)}", f"DESCRIPTION:{_esc(tx['note'])}"]
                   + ([f"RRULE:{rrule}"] if rrule else [])
                   + ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(summary)}", f"TRIGGER:-PT{alarm_min}M",
                      "END:VALARM", "END:VEVENT"])

    for it in items:
        if it["status"] != "active":
            continue
        if it["kind"] == "medicine" and it.get("times") and it.get("schedule") in ("daily", "weekly"):
            start = max(date.fromisoformat(it["start_date"]) if it.get("start_date") else today, today)
            if it["schedule"] == "weekly" and it.get("weekday") is not None:
                start += timedelta(days=(it["weekday"] - start.weekday()) % 7)
            end = date.fromisoformat(it["end_date"]) if it.get("end_date") else None
            if end and end < start:
                continue
            label = f"{it['title']} {it.get('detail') or ''}".strip()
            timing = (it.get("meta") or {}).get("timing")
            for t in it["times"]:
                rule = "FREQ=WEEKLY" if it["schedule"] == "weekly" else "FREQ=DAILY"
                if end:
                    until = datetime.combine(end, datetime.strptime(t, "%H:%M").time(), IST).astimezone(timezone.utc)
                    rule += f";UNTIL={until.strftime('%Y%m%dT%H%M%SZ')}"
                event(f"{it['id']}-{t.replace(':', '')}", f"{start.strftime('%Y%m%d')}T{t.replace(':', '')}00",
                      tx["med"].format(name=label) + (f" ({timing})" if timing else ""), rule)
        elif it["kind"] in ("appointment", "repeat_test") and it.get("due_date"):
            due = date.fromisoformat(it["due_date"])
            overdue = due < today
            when = today + timedelta(days=1) if overdue else due
            key = "visit" if it["kind"] == "appointment" else "test"
            summary = tx[key].format(name=it["title"]) + (f" - {tx['overdue']}" if overdue else "")
            event(f"{it['id']}-due", f"{when.strftime('%Y%m%d')}T090000", summary, alarm_min=24 * 60)
    out.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in out) + "\r\n"


def _fold(line: str) -> str:
    """RFC 5545: lines longer than 75 octets continue on the next line after CRLF + space.
    Splits on character boundaries so Hindi and Telugu text is never cut mid-character."""
    if len(line.encode("utf-8")) <= 75:
        return line
    parts, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > (75 if not parts else 74):
            parts.append(cur)
            cur, size = "", 0
        cur += ch
        size += n
    parts.append(cur)
    return "\r\n ".join(parts)


@router.get("/profiles/{profile_id}/care-plan.ics")
async def care_plan_ics(profile_id: UUID, lang: Literal["en", "hi", "te"] = "en",
                        day: Optional[str] = Query(None, alias="date"), owner: str = Depends(current_user_id)):
    profile = await asyncio.to_thread(_profile_or_404, owner, profile_id)
    today = _today(day)
    try:
        items = await asyncio.to_thread(care_store.list_items, owner, str(profile_id))
    except Exception as e:  # noqa: BLE001 - care tables not migrated yet: export the live plan
        if not care_store.is_missing_table(e):
            raise
        records = await asyncio.to_thread(store.list_records, owner, str(profile_id))
        items = care_store.ephemeral_items(str(profile_id), records, today)
    body = build_ics(items, profile.name, lang, today)
    fname = "".join(c if c.isalnum() else "-" for c in profile.name.lower()).strip("-") or "care-plan"
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fname}-reminders.ics"'})
