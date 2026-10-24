import re
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.schemas.payloads import ABHALinkRequest, Profile, ProfileCreate
from app.services import care_store, store
from app.services.auth import current_user_id
from app.services.fhir_mapper import profile_collection
from app.services.trends import Trend, build_trends

router = APIRouter(prefix="/profiles", tags=["Family profiles"])

ABHA_NUMBER = re.compile(r"^\d{2}-\d{4}-\d{4}-\d{4}$")
ABHA_ADDRESS = re.compile(r"^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$")


@router.get("", response_model=list[Profile])
def list_profiles(owner: str = Depends(current_user_id)):
    return store.list_profiles(owner)


@router.post("", response_model=Profile, status_code=201)
def create_profile(body: ProfileCreate, owner: str = Depends(current_user_id)):
    profile = Profile(id=store.new_id(), name=body.name.strip(), relation=body.relation.strip() or "Family member",
                      age=body.age, sex=body.sex, created_at=store.now_iso())
    return store.save_profile(owner, profile)


@router.delete("/{profile_id}", status_code=204)
def delete_profile(profile_id: str, owner: str = Depends(current_user_id)):
    if not store.get_profile(owner, profile_id):
        raise HTTPException(404, "Profile not found")
    store.delete_profile(owner, profile_id)


@router.post("/{profile_id}/abha", response_model=Profile)
def link_abha(profile_id: str, body: ABHALinkRequest, owner: str = Depends(current_user_id)):
    """Validates the ABHA credentials, links the profile, and fetches records from
    the ABDM mock gateway catalog into the user's health timeline."""
    profile = store.get_profile(owner, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    number = (body.abha_number or "").strip()
    address = (body.abha_address or "").strip().lower()
    if number:
        digits = re.sub(r"\D", "", number)
        if len(digits) != 14:
            raise HTTPException(422, "An ABHA number has 14 digits, like 91-1234-5678-9012.")
        number = f"{digits[:2]}-{digits[2:6]}-{digits[6:10]}-{digits[10:]}"
    if address and not ABHA_ADDRESS.match(address):
        raise HTTPException(422, "An ABHA address looks like name@abdm.")
    if not number and not address:
        raise HTTPException(422, "Enter an ABHA number or an ABHA address.")
    profile.abha_number = number or profile.abha_number
    profile.abha_address = address or profile.abha_address
    profile.abha_linked = True
    profile.abha_linked_at = store.now_iso()
    saved = store.save_profile(owner, profile)

    # Fetch and attach ABHA documents for this patient
    store.fetch_and_link_abha_records(owner, saved, saved.abha_number or "", saved.abha_address or "")

    # Sync care plan items from the new records
    try:
        care_store.sync(owner, saved.id, date.today())
    except Exception:
        pass

    store.audit(owner, "abha_link", profile.id)
    return saved


@router.delete("/{profile_id}/abha", response_model=Profile)
def unlink_abha(profile_id: str, owner: str = Depends(current_user_id)):
    """Unlinks ABHA identity and removes all ABDM-fetched documents from the health timeline."""
    profile = store.get_profile(owner, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")

    # Clean up all records imported from the ABHA gateway
    store.remove_abha_records(owner, profile.id)

    profile.abha_linked = False
    profile.abha_number = None
    profile.abha_address = None
    profile.abha_linked_at = None
    saved = store.save_profile(owner, profile)

    # Re-sync care plan items after removing ABHA records
    try:
        care_store.sync(owner, saved.id, date.today())
    except Exception:
        pass

    store.audit(owner, "abha_unlink", profile.id)
    return saved


@router.get("/{profile_id}/fhir")
def export_fhir(profile_id: str, owner: str = Depends(current_user_id)):
    profile = store.get_profile(owner, profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    bundles = [r.fhir_bundle for r in store.list_records(owner, profile_id)]
    store.audit(owner, "fhir_export", profile.id)
    safe = re.sub(r"[^a-z0-9]+", "-", profile.name.lower()).strip("-")
    return JSONResponse(profile_collection(profile, bundles), media_type="application/fhir+json",
                        headers={"Content-Disposition": f'attachment; filename="{safe}-fhir-r4.json"'})


@router.get("/{profile_id}/trends", response_model=list[Trend])
def trends(profile_id: str, owner: str = Depends(current_user_id)):
    """Tests repeated across this person's reports, oldest to newest, judged against the printed range."""
    if not store.get_profile(owner, profile_id):
        raise HTTPException(404, "Profile not found")
    return build_trends(store.list_records(owner, profile_id))
