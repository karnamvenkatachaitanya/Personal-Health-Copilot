"""ABDM / ABHA mock gateway catalog: Realistic clinical records provided by
Indian healthcare providers (Apollo Hospitals, Dr Lal PathLabs, Fortis Healthcare)
with NRCES-compliant FHIR R4 bundles.
"""
from typing import List, Dict, Any
from app.schemas.payloads import (
    ExtractedRecord,
    ExtractionMeta,
    HealthRecord,
    Localized,
    LocalizedList,
    MedicationItem,
    LabObservationItem,
    Profile,
)
from app.services.fhir_mapper import to_fhir_bundle


def generate_abha_records_for_profile(profile: Profile, abha_number: str, abha_address: str) -> List[Dict[str, Any]]:
    """Generates a bundle of realistic clinical records imported from the ABHA health network,
    personalized to the patient's demographics."""
    p_name = profile.name
    p_age = profile.age or "45"
    p_sex = profile.sex or "M"

    items = [
        # 1. Apollo Hospitals - Cardiology Prescription
        {
            "document_type": "Prescription",
            "record_date": "2026-09-15",
            "title": f"Cardiology Prescription, Apollo Hospitals ({abha_address or abha_number})",
            "source_filename": f"ABHA: Apollo Hospitals - Cardiology Prescription.pdf",
            "source_mime": "application/pdf",
            "extracted": ExtractedRecord(
                record_type="Prescription",
                record_date="2026-09-15",
                patient_name=p_name,
                patient_age=p_age,
                patient_sex=p_sex,
                doctor_name="Dr. K. S. Reddy, MD, DM (Cardiology)",
                facility_name="Apollo Hospitals, Jubilee Hills, Hyderabad",
                diagnoses=["Essential Hypertension", "Mild Dyslipidemia"],
                medications=[
                    MedicationItem(
                        name="Telmisartan",
                        form="Tablet",
                        dosage="40 mg",
                        frequency="Once daily",
                        timing="Morning after breakfast",
                        duration="90 days",
                        instructions=Localized(
                            english="Take 1 tablet every morning with water. Do not skip doses.",
                            hindi="रोजाना सुबह नाश्ते के बाद 1 गोली पानी के साथ लें।",
                            telugu="ప్రతిరోజూ ఉదయం అల్పాహారం తర్వాత 1 టాబ్లెట్ నీటితో తీసుకోండి.",
                        ),
                    ),
                    MedicationItem(
                        name="Atorvastatin",
                        form="Tablet",
                        dosage="10 mg",
                        frequency="Once daily",
                        timing="Night before sleep",
                        duration="90 days",
                        instructions=Localized(
                            english="Take 1 tablet at night before bedtime to control cholesterol.",
                            hindi="कोलेस्ट्रॉल नियंत्रित करने के लिए रात को सोने से पहले 1 गोली लें।",
                            telugu="కొలెస్ట్రాల్ నియంత్రణ కోసం రాత్రి పడుకునే ముందు 1 టాబ్లెట్ తీసుకోండి.",
                        ),
                    ),
                    MedicationItem(
                        name="Aspirin (Ecosprin)",
                        form="Tablet",
                        dosage="75 mg",
                        frequency="Once daily",
                        timing="After lunch",
                        duration="90 days",
                        instructions=Localized(
                            english="Take 1 tablet daily after food.",
                            hindi="दोपहर के भोजन के बाद 1 गोली लें।",
                            telugu="మధ్యాహ్న భోజనం తర్వాత 1 టాబ్లెట్ తీసుకోండి.",
                        ),
                    ),
                ],
                lab_observations=[],
                summary=Localized(
                    english=f"ABHA Record: Cardiology consultation at Apollo Hospitals for {p_name}. Prescribed Telmisartan 40mg and Atorvastatin 10mg for blood pressure and lipid management. Recommended low salt diet, daily brisk walking, and repeat lipid profile in 3 months.",
                    hindi=f"ABHA रिकॉर्ड: {p_name} के लिए अपोलो हॉस्पिटल्स में कार्डियोलॉजी परामर्श। रक्तचाप और लिपिड प्रबंधन के लिए टेल्मीसार्टन 40 मिलीग्राम और एटोरवास्टेटिन 10 मिलीग्राम दी गई।",
                    telugu=f"ABHA రికార్డు: {p_name} కొరకు అపోలో హాస్పిటల్స్‌లో కార్డియాలజీ కన్సల్టేషన్. రక్తపోటు మరియు కొలెస్ట్రాల్ నియంత్రణకు టెల్మిసార్టాన్ 40mg, అటోర్వాస్టాటిన్ 10mg సూచించబడ్డాయి.",
                ),
                doctor_questions=LocalizedList(
                    english=["Should I take blood pressure medication on an empty stomach?", "When is the next lipid profile due?"],
                    hindi=["क्या रक्तचाप की दवा खाली पेट लेनी चाहिए?", "अगली लिपिड जांच कब करानी है?"],
                    telugu=["రక్తపోటు మందును ఖాళీ కడుపుతో తీసుకోవచ్చా?", "తదుపరి లిపిడ్ పరీక్ష ఎప్పుడు చేయించాలి?"],
                ),
                follow_up="Follow up after 3 months with repeat Fasting Lipid Profile.",
            ),
        },
        # 2. Dr Lal PathLabs - Comprehensive Metabolic & Lipid Panel
        {
            "document_type": "DiagnosticReport",
            "record_date": "2026-09-12",
            "title": f"Lipid & Glycemic Profile, Dr Lal PathLabs ({abha_address or abha_number})",
            "source_filename": f"ABHA: Dr Lal PathLabs - Diagnostic Report.pdf",
            "source_mime": "application/pdf",
            "extracted": ExtractedRecord(
                record_type="DiagnosticReport",
                record_date="2026-09-12",
                patient_name=p_name,
                patient_age=p_age,
                patient_sex=p_sex,
                doctor_name="Dr. Anita Verma, Consultant Pathologist",
                facility_name="Dr Lal PathLabs, National Reference Lab",
                diagnoses=["Dyslipidemia", "Borderline Hyperglycemia"],
                medications=[],
                lab_observations=[
                    LabObservationItem(
                        test_name="Total Cholesterol",
                        observed_value="218",
                        unit="mg/dL",
                        reference_range="< 200",
                        flag="HIGH",
                        flag_source="computed",
                        explanation=Localized(
                            english="Total cholesterol is slightly elevated above the desirable limit of 200 mg/dL.",
                            hindi="कुल कोलेस्ट्रॉल 200 mg/dL की सामान्य सीमा से कुछ अधिक है।",
                            telugu="మొత్తం కొలెస్ట్రాల్ సాధారణ పరిమితి 200 mg/dL కంటే కొద్దిగా ఎక్కువగా ఉంది.",
                        ),
                    ),
                    LabObservationItem(
                        test_name="LDL Cholesterol",
                        observed_value="138",
                        unit="mg/dL",
                        reference_range="< 100",
                        flag="HIGH",
                        flag_source="computed",
                        explanation=Localized(
                            english="LDL ('bad cholesterol') is higher than the recommended target of 100 mg/dL.",
                            hindi="एलडीएल ('खराब कोलेस्ट्रॉल') अनुशंसित लक्ष्य से अधिक है।",
                            telugu="ఎల్‌డిఎల్ ('చెడు కొలెస్ట్రాల్') సిఫార్సు చేసిన పరిమితి కంటే ఎక్కువగా ఉంది.",
                        ),
                    ),
                    LabObservationItem(
                        test_name="HDL Cholesterol",
                        observed_value="46",
                        unit="mg/dL",
                        reference_range="> 40",
                        flag="NORMAL",
                        flag_source="computed",
                    ),
                    LabObservationItem(
                        test_name="Triglycerides",
                        observed_value="182",
                        unit="mg/dL",
                        reference_range="< 150",
                        flag="HIGH",
                        flag_source="computed",
                        explanation=Localized(
                            english="Triglycerides are elevated. Regular aerobic activity and dietary sugar reduction help lower it.",
                            hindi="ट्राइग्लिसराइड्स बढ़े हुए हैं। व्यायाम और मीठा कम करने से इसमें सुधार होता है।",
                            telugu="ట్రైగ్లిజరైడ్స్ ఎక్కువగా ఉన్నాయి. వ్యాయామం చేయడం వల్ల ఇవి తగ్గుతాయి.",
                        ),
                    ),
                    LabObservationItem(
                        test_name="HbA1c",
                        observed_value="6.1",
                        unit="%",
                        reference_range="4.0 - 5.6",
                        flag="HIGH",
                        flag_source="computed",
                        explanation=Localized(
                            english="HbA1c is 6.1%, indicating pre-diabetes range. Lifestyle intervention advised.",
                            hindi="एचबीए1सी 6.1% है, जो प्रीडायबिटीज दर्शाता है।",
                            telugu="హెచ్‌బిఎ1సి 6.1% ఉంది, ఇది ప్రీ-డయాబెటిస్ పరిధిని సూచిస్తుంది.",
                        ),
                    ),
                    LabObservationItem(
                        test_name="Fasting Blood Glucose",
                        observed_value="106",
                        unit="mg/dL",
                        reference_range="70 - 100",
                        flag="HIGH",
                        flag_source="computed",
                    ),
                    LabObservationItem(
                        test_name="Serum Creatinine",
                        observed_value="0.92",
                        unit="mg/dL",
                        reference_range="0.6 - 1.2",
                        flag="NORMAL",
                        flag_source="computed",
                    ),
                ],
                summary=Localized(
                    english=f"ABHA Record: 12-hour fasting blood panel for {p_name} from Dr Lal PathLabs. Total cholesterol (218 mg/dL) and LDL (138 mg/dL) are elevated. HbA1c is 6.1% (pre-diabetic). Renal function is normal.",
                    hindi=f"ABHA रिकॉर्ड: {p_name} के लिए डॉ लाल पैथलैब्स की जांच रिपोर्ट। कुल कोलेस्ट्रॉल (218) और एलडीएल (138) बढ़े हुए हैं। एचबीए1सी 6.1% है। गुर्दे का कार्य सामान्य है।",
                    telugu=f"ABHA రికార్డు: డాక్టర్ లాల్ పాథ్‌ల్యాబ్స్ రక్త పరీక్ష. కొలెస్ట్రాల్ (218 mg/dL), ఎల్‌డిఎల్ (138 mg/dL) ఎక్కువగా ఉన్నాయి. కిడ్నీ పనితీరు సాధారణంగా ఉంది.",
                ),
            ),
        },
        # 3. Fortis Healthcare - Discharge Summary
        {
            "document_type": "DischargeSummary",
            "record_date": "2026-08-01",
            "title": f"Medical Evaluation & Discharge Summary, Fortis ({abha_address or abha_number})",
            "source_filename": f"ABHA: Fortis Healthcare - Discharge Summary.pdf",
            "source_mime": "application/pdf",
            "extracted": ExtractedRecord(
                record_type="DischargeSummary",
                record_date="2026-08-01",
                patient_name=p_name,
                patient_age=p_age,
                patient_sex=p_sex,
                doctor_name="Dr. Ramesh Gupta, Senior Consultant",
                facility_name="Fortis Healthcare, Vasant Kunj",
                diagnoses=["Atypical Chest Discomfort (Resolved)", "Stage 1 Essential Hypertension"],
                medications=[
                    MedicationItem(
                        name="Amlodipine",
                        form="Tablet",
                        dosage="5 mg",
                        frequency="Once daily",
                        timing="Morning",
                        duration="30 days",
                    ),
                ],
                lab_observations=[
                    LabObservationItem(
                        test_name="Troponin I",
                        observed_value="0.01",
                        unit="ng/mL",
                        reference_range="< 0.04",
                        flag="NORMAL",
                        flag_source="computed",
                    ),
                    LabObservationItem(
                        test_name="ECG",
                        observed_value="Normal Sinus Rhythm",
                        unit="",
                        reference_range="Normal",
                        flag="NORMAL",
                        flag_source="computed",
                    ),
                ],
                summary=Localized(
                    english=f"ABHA Record: 24-hour observation summary at Fortis Healthcare for {p_name}. Cardiac enzymes and ECG were entirely normal, ruling out acute coronary syndrome. Diagnosed with mild stress-related chest discomfort and Stage 1 hypertension. Discharged in stable condition.",
                    hindi=f"ABHA रिकॉर्ड: फोर्टिस हेल्थकेयर में {p_name} के लिए निगरानी रिपोर्ट। ईसीजी और कार्डियक एंजाइम पूरी तरह सामान्य रहे। मरीज को स्थिर स्थिति में छुट्टी दी गई।",
                    telugu=f"ABHA రికార్డు: ఫోర్టిస్ హాస్పిటల్‌లో 24 గంటల పర్యవేక్షణ. ఈసీజీ మరియు గుండె పరీక్షలు అన్నీ నార్మల్‌గా ఉన్నాయి. రోగి పరిస్థితి నిలకడగా ఉన్నందున డిశ్చార్జ్ చేశారు.",
                ),
                follow_up="Consult cardiologist OPD after 4 weeks.",
            ),
        },
    ]

    return items
