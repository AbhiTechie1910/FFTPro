document.addEventListener("DOMContentLoaded", () => {
  const PATIENTS_KEY = "fft_patients_v1";
  const ACTIVE_PATIENT_KEY = "fft_active_patient_v1";
  const PROFILE_KEY = "fft_therapist_profile_v1";

  const CONSENT_VERSION = "v1.0";
  const FALLBACK_STAMP = "assets/clinic/clinic-stamp.png";

  const patientNameEl = document.getElementById("patientName");
  const patientIdEl = document.getElementById("patientId");
  const patientAgeGenderEl = document.getElementById("patientAgeGender");
  const patientNationalityEl = document.getElementById("patientNationality");
  const patientHeightWeightEl = document.getElementById("patientHeightWeight");
  const patientPainScoreEl = document.getElementById("patientPainScore");

  const therapistNameEl = document.getElementById("therapistName");
  const clinicNameEl = document.getElementById("clinicName");
  const clinicStampImg = document.getElementById("clinicStamp");

  const tsEl = document.getElementById("consentTimestamp");
  const verEl = document.getElementById("consentVersion");

  const consentCheck = document.getElementById("consentCheck");
  const startBtn = document.getElementById("startBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const downloadPdfBtn = document.getElementById("downloadPdfBtn");

  const params = new URLSearchParams(window.location.search);
  const patientIdFromUrl = params.get("patient");

  const patients = JSON.parse(localStorage.getItem(PATIENTS_KEY) || "[]");

  let activePatient = null;
  if (patientIdFromUrl) {
    activePatient = patients.find(p => p.patientId === patientIdFromUrl) || null;
  }
  if (!activePatient) {
    activePatient = JSON.parse(localStorage.getItem(ACTIVE_PATIENT_KEY) || "null");
  }

  if (!activePatient || !activePatient.patientId) {
    alert("No patient found. Please save a patient first.");
    window.location.href = "patient-intake.html";
    return;
  }

  const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") || {};
  const therapistName = profile.therapistName || "—";
  const clinicName = profile.clinicName || "—";
  const stampSrc = profile.stampDataUrl || FALLBACK_STAMP;

  therapistNameEl.textContent = therapistName;
  clinicNameEl.textContent = clinicName;
  clinicStampImg.src = stampSrc;

  verEl.textContent = CONSENT_VERSION;

  patientNameEl.textContent = activePatient.fullName || "—";
  patientIdEl.textContent = activePatient.patientId || "—";
  patientAgeGenderEl.textContent = `Age: ${activePatient.age ?? "—"} | Gender: ${activePatient.gender ?? "—"}`;
  patientNationalityEl.textContent = activePatient.nationality
    ? `Nationality: ${activePatient.nationality}`
    : "Nationality: —";
  patientHeightWeightEl.textContent =
    `Height: ${activePatient.heightCm ?? "—"} cm | Weight: ${activePatient.weightKg ?? "—"} kg`;
  patientPainScoreEl.textContent = `Pain Score: ${activePatient.painScore ?? "—"}`;

  let consentIso = activePatient.consentTimestamp || "";
  if (activePatient.consentTimestamp) {
    tsEl.textContent = new Date(activePatient.consentTimestamp).toLocaleString();
  } else {
    tsEl.textContent = "—";
  }

  if (activePatient.consentGiven) {
    consentCheck.checked = true;
  }
  startBtn.disabled = !consentCheck.checked;

  consentCheck.addEventListener("change", () => {
    startBtn.disabled = !consentCheck.checked;
    if (consentCheck.checked) {
      consentIso = new Date().toISOString();
      tsEl.textContent = new Date(consentIso).toLocaleString();
    } else {
      consentIso = "";
      tsEl.textContent = "—";
    }
  });

  cancelBtn.addEventListener("click", () => {
    window.location.href = "patient-intake.html";
  });

  startBtn.addEventListener("click", () => {
    if (!consentCheck.checked) return;

    const nowIso = consentIso || new Date().toISOString();

    const updated = patients.map(p => {
      if (p.patientId === activePatient.patientId) {
        return {
          ...p,
          consentGiven: true,
          consentTimestamp: nowIso,
          consentVersion: CONSENT_VERSION,
          consentTherapist: therapistName,
          consentClinic: clinicName
        };
      }
      return p;
    });

    localStorage.setItem(PATIENTS_KEY, JSON.stringify(updated));

    activePatient.consentGiven = true;
    activePatient.consentTimestamp = nowIso;
    activePatient.consentVersion = CONSENT_VERSION;
    activePatient.consentTherapist = therapistName;
    activePatient.consentClinic = clinicName;
    localStorage.setItem(ACTIVE_PATIENT_KEY, JSON.stringify(activePatient));

    window.location.href = "assessments-select.html?patient=" + encodeURIComponent(activePatient.patientId);
  });

  async function loadImageAsDataURL(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function wrapText(doc, text, x, y, maxWidth, lineHeight) {
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line, idx) => {
      doc.text(line, x, y + (idx * lineHeight));
    });
    return y + (lines.length * lineHeight);
  }

  downloadPdfBtn.addEventListener("click", async () => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("PDF library not loaded. If you are offline, host jsPDF locally.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 44;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("FFTPro — Digital Informed Consent & Data Use Agreement", margin, 56);

    doc.setDrawColor(229, 231, 235);
    doc.line(margin, 70, pageW - margin, 70);

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Patient Details", margin, 98);

    doc.setFont("helvetica", "normal");
    doc.text(`Name: ${activePatient.fullName || "—"}`, margin, 118);
    doc.text(`Patient ID: ${activePatient.patientId || "—"}`, margin, 134);
    doc.text(`Age/Gender: ${activePatient.age ?? "—"} / ${activePatient.gender ?? "—"}`, margin, 150);
    doc.text(`Nationality: ${activePatient.nationality || "—"}`, margin, 166);
    doc.text(`Height/Weight: ${activePatient.heightCm ?? "—"} cm / ${activePatient.weightKg ?? "—"} kg`, margin, 182);
    doc.text(`Pain Score: ${activePatient.painScore ?? "—"}`, margin, 198);

    doc.setFont("helvetica", "bold");
    doc.text("Therapist / Clinic", pageW/2 + 10, 98);
    doc.setFont("helvetica", "normal");
    doc.text(`Therapist: ${therapistName}`, pageW/2 + 10, 118);
    doc.text(`Clinic: ${clinicName}`, pageW/2 + 10, 134);

    let stampDataUrl = null;
    try {
      stampDataUrl = await loadImageAsDataURL(stampSrc);
      doc.addImage(stampDataUrl, "PNG", pageW - margin - 140, 92, 140, 70);
    } catch (e) {
      // ignore missing stamp
    }

    doc.setFont("helvetica", "bold");
    doc.text("Time and Date", margin, 230);
    doc.setFont("helvetica", "normal");
    const tsDisplay = consentIso ? new Date(consentIso).toLocaleString() : new Date().toLocaleString();
    doc.text(`Timestamp: ${tsDisplay}`, margin, 250);

    let y = 290;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Consent Terms (Summary)", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const terms = [
      "1) Purpose: FFTPro assessments evaluate functional fitness parameters (strength, balance, flexibility, endurance, mobility) to support clinical documentation and progress tracking.",
      "2) Data Collected: Demographics (name, age, gender, nationality, Patient ID), assessment results/metrics, clinician observations, derived measurements (angles, distances, timing), and visual/motion inputs (video feed, frames if required, pose-estimation markers).",
      "3) Video/Image Use: Video/image data is processed solely for clinical assessment, measurement, and reporting within FFTPro and is not used for advertising or unrelated commercial purposes.",
      "4) Storage & Security: Data is stored using reasonable safeguards and access controls to mitigate unauthorized access or disclosure.",
      "5) Confidentiality: Data is treated as confidential healthcare information, disclosed only where legally required, explicitly authorized, or necessary for compliance within permitted limits.",
      "6) Voluntary Participation: Participation is voluntary; consent may be withdrawn at any time, which may affect completion/records.",
      "7) Limitation: FFTPro is a support tool; clinical interpretation remains with the therapist. Liability is limited for interruptions beyond reasonable control."
    ].join("\n\n");

    y = wrapText(doc, terms, margin, y, pageW - (margin * 2), 14);

    y += 10;
    doc.setFont("helvetica", "bold");
    doc.text("Patient Declaration", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    const declaration =
      "I confirm that I have read and understood this consent and voluntarily agree to the collection, processing, and secure storage of my video, image, demographic and healthcare-related assessment data for clinical purposes as described above.";
    y = wrapText(doc, declaration, margin, y, pageW - (margin * 2), 14);

    y += 26;
    doc.setDrawColor(100, 116, 139);
    doc.line(margin, y, margin + 220, y);
    doc.line(pageW/2 + 10, y, pageW/2 + 230, y);

    doc.setFont("helvetica", "normal");
    doc.text("Patient Signature", margin, y + 14);
    doc.text("Therapist Signature", pageW/2 + 10, y + 14);

    doc.setDrawColor(229, 231, 235);
    doc.line(margin, pageH - 62, pageW - margin, pageH - 62);
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Generated by FFTPro • Consent ${CONSENT_VERSION} • Patient: ${activePatient.patientId} • ${new Date().toLocaleString()}`,
      margin,
      pageH - 42
    );

    const safeName = (activePatient.fullName || "Patient").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `FFTPro_Consent_${activePatient.patientId}_${safeName}.pdf`;

    doc.save(filename);
  });
});
