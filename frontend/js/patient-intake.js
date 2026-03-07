const STORAGE_KEY_ACTIVE_PATIENT = "fft_active_patient_v1";

// ✅ change this only if your backend runs on a different port
const API_BASE = "http://127.0.0.1:5000";

document.addEventListener("DOMContentLoaded", () => {
  console.log("patient-intake.js loaded (DB mode)");

  const patientForm = document.getElementById("patientForm");
  const resetBtn = document.getElementById("resetBtn");
  const ageSelect = document.getElementById("age");
  const painSelect = document.getElementById("painScore");

  if (!patientForm) {
    console.error("Missing #patientForm in HTML. Save cannot work.");
    alert("Error: patientForm not found. Check patient-intake.html IDs.");
    return;
  }

  function populateSelectRange(selectEl, start, end) {
    if (!selectEl) return;
    // avoid duplicate options if script loads twice
    const existing = new Set([...selectEl.options].map(o => o.value));
    for (let i = start; i <= end; i += 1) {
      const v = String(i);
      if (existing.has(v)) continue;
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    }
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data?.errors && data.errors.join(", ")) ||
                  data?.error ||
                  `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  patientForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullNameEl = document.getElementById("fullName");
    const ageEl = document.getElementById("age");
    const genderEl = document.getElementById("gender");
    const heightEl = document.getElementById("heightCm");
    const weightEl = document.getElementById("weightKg");
    const painEl = document.getElementById("painScore");
    const nationalityEl = document.getElementById("nationality");

    if (!fullNameEl || !ageEl || !genderEl || !heightEl || !weightEl || !painEl) {
      alert("Form inputs missing. Check IDs: fullName, age, gender, heightCm, weightKg, painScore.");
      return;
    }

    const full_name = fullNameEl.value.trim();
    const age_years = Number(ageEl.value);
    const gender = genderEl.value;
    const height_cm = Number(heightEl.value);
    const weight_kg = Number(weightEl.value);
    const pain_score = Number(painEl.value);
    const nationality = nationalityEl ? nationalityEl.value.trim() : "";

    if (!full_name || !age_years || !gender || !height_cm || !weight_kg || isNaN(pain_score)) {
      alert("Please fill all required patient details.");
      return;
    }

    // Payload expected by backend
    const payload = {
      full_name,
      age_years,
      gender,
      height_cm,
      weight_kg,
      pain_score,
      nationality: nationality || null
    };

    try {
      // ✅ backend should respond with: { ok: true, patient: {...} }
      const resp = await postJSON(`${API_BASE}/api/patients`, payload);
      const saved = resp.patient ?? resp; // supports both formats just in case

      // Normalize to your old structure so rest of website doesn’t break
      const patient = {
        patientId: saved.patient_id,     // ✅ DB-generated
        fullName: saved.full_name,
        age: saved.age_years,
        gender: saved.gender,
        heightCm: Number(saved.height_cm),
        weightKg: Number(saved.weight_kg),
        painScore: Number(saved.pain_score),
        nationality: saved.nationality || "",
        consentGiven: false,
        consentTimestamp: null,
        createdAt: saved.created_at || new Date().toISOString()
      };

      // store active patient (same key you used earlier)
      localStorage.setItem(STORAGE_KEY_ACTIVE_PATIENT, JSON.stringify(patient));

      patientForm.reset();

      // redirect same as before
      window.location.href = `consent.html?patient=${encodeURIComponent(patient.patientId)}`;

    } catch (err) {
      console.error(err);
      alert(`❌ Failed to save patient: ${err.message}`);
    }
  });

  if (resetBtn) resetBtn.addEventListener("click", () => patientForm.reset());

  populateSelectRange(ageSelect, 1, 120);
  populateSelectRange(painSelect, 0, 10);
});