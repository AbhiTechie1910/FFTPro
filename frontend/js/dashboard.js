document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY_PATIENTS = "fft_patients_v1";
  const STORAGE_KEY_ACTIVE_PATIENT = "fft_active_patient_v1";

  const currentDateEl = document.getElementById("currentDate");
  const totalPatientsEl = document.getElementById("totalPatients");

  const patientsTableBody = document.querySelector("#patientsTable tbody");
  const searchInput = document.getElementById("searchPatient");
  const session = JSON.parse(localStorage.getItem("fft_session_v1") || "null");
  if (!session || !session.email) {
    window.location.href = "login.html";
  }

  // ---------- Helpers ----------
  function loadPatients() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_PATIENTS) || "[]");
  }

  function savePatients(patients) {
    localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(patients));
  }

  function formatDatePretty(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleString();
  }

  function setToday() {
    if (!currentDateEl) return;
    const now = new Date();
    currentDateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function updateSummary(patients) {
    if (totalPatientsEl) totalPatientsEl.textContent = patients.length;
  }

  // ---------- Render Table ----------
  function renderPatientsTable(filterText = "") {
    if (!patientsTableBody) return;

    const patients = loadPatients();

    // summary
    updateSummary(patients);

    const q = (filterText || "").trim().toLowerCase();
    const filtered = !q
      ? patients
      : patients.filter(p => {
          const id = (p.patientId || "").toLowerCase();
          const name = (p.fullName || "").toLowerCase();
          return id.includes(q) || name.includes(q);
        });

    // clear
    patientsTableBody.innerHTML = "";

    if (filtered.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td colspan="6" style="padding:14px;color:#6b7280;">
          No patients found.
        </td>
      `;
      patientsTableBody.appendChild(tr);
      return;
    }

    // sort newest first (createdAt)
// sort newest first
  const recentThree = filtered
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 3);   //  ONLY 3 MOST RECENT

  recentThree.forEach(p => {
    const tr = document.createElement("tr");

    const lastTest = p.lastTestName || "—";

    tr.innerHTML = `
      <td>${p.patientId || "—"}</td>
      <td>${p.fullName || "—"}</td>
      <td>${p.age ?? "—"}</td>
      <td>${p.gender || "—"}</td>
      <td>${lastTest}</td>
      <td>
        <button class="action-btn view-btn" data-id="${p.patientId}">View</button>
        <button class="action-btn assess-btn" data-id="${p.patientId}">Assess</button>
        <button class="action-btn delete-btn" data-id="${p.patientId}">Delete</button>
      </td>
    `;

  patientsTableBody.appendChild(tr);
});

  }

  // ---------- Actions (View / Assess / Delete) ----------
  function handleTableClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;

    const patientId = btn.getAttribute("data-id");
    if (!patientId) return;

    const patients = loadPatients();
    const patient = patients.find(p => p.patientId === patientId);

    if (btn.classList.contains("view-btn")) {
      if (!patient) return alert("Patient not found.");
      const msg =
        `Patient: ${patient.fullName}\n` +
        `ID: ${patient.patientId}\n` +
        `Age: ${patient.age}\n` +
        `Gender: ${patient.gender}\n` +
        `Nationality: ${patient.nationality || "—"}\n` +
        `Created: ${formatDatePretty(patient.createdAt)}\n` +
        `Consent: ${patient.consentGiven ? "Yes" : "No"}`;
      alert(msg);
      return;
    }

    if (btn.classList.contains("start-btn")) {
      if (!patient) return alert("Patient not found.");

      // Make this patient active for patient-intake + consent flow
      localStorage.setItem(STORAGE_KEY_ACTIVE_PATIENT, JSON.stringify(patient));

      // Go to intake where user selects tests and starts
      window.location.href = "patient-intake.html";
      return;
    }

    if (btn.classList.contains("delete-btn")) {
      const ok = confirm(`Delete patient ${patientId}? This cannot be undone.`);
      if (!ok) return;

      const updated = patients.filter(p => p.patientId !== patientId);
      savePatients(updated);

      // Refresh table
      renderPatientsTable(searchInput ? searchInput.value : "");
      return;
    }
  }

  // ---------- Wire Up ----------
  setToday();
  renderPatientsTable();

  if (patientsTableBody) {
    patientsTableBody.addEventListener("click", handleTableClick);
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderPatientsTable(searchInput.value);
    });
  }

  // Optional: refresh if dashboard is re-opened and localStorage changed elsewhere
  window.addEventListener("focus", () => {
    renderPatientsTable(searchInput ? searchInput.value : "");
  });
});
