const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = 5000;
const JWT_SECRET = "fftpro_super_secret_key";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "postgres1",
  password: "fftpro@1910",
  port: 5432,
});

pool.connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch((err) => console.error("Database connection error:", err));

/* =========================
   HELPERS
========================= */

function normalizeBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return value;
}

function normalizeInt(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function badRequest(res, message) {
  return res.status(400).json({
    success: false,
    message,
  });
}

function serverError(res, err, message = "Internal server error.") {
  console.error(message, err);
  return res.status(500).json({
    success: false,
    message,
    error: err.message,
  });
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {
  res.send("Backend is running");
});

/* =========================
   AUTH - REGISTER
========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, full_name, email, password, role } = req.body;

    const resolvedName = (name || full_name || "").trim();
    const resolvedEmail = (email || "").trim().toLowerCase();
    const resolvedPassword = password || "";
    const resolvedRole = (role || "Therapist").trim();

    if (!resolvedName || !resolvedEmail || !resolvedPassword) {
      return badRequest(res, "Name, email and password are required.");
    }

    if (resolvedPassword.length < 8) {
      return badRequest(res, "Password must be at least 8 characters.");
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [resolvedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email.",
      });
    }

    const passwordHash = await bcrypt.hash(resolvedPassword, 10);

    const result = await pool.query(
      `
      INSERT INTO users (full_name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name, email, role, created_at
      `,
      [resolvedName, resolvedEmail, passwordHash, resolvedRole]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    return serverError(res, err, "Register error:");
  }
});

/* Backward-compatible alias */
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;

    const resolvedName = (full_name || "").trim();
    const resolvedEmail = (email || "").trim().toLowerCase();
    const resolvedPassword = password || "";
    const resolvedRole = (role || "Therapist").trim();

    if (!resolvedName || !resolvedEmail || !resolvedPassword) {
      return badRequest(res, "Full name, email and password are required.");
    }

    if (resolvedPassword.length < 8) {
      return badRequest(res, "Password must be at least 8 characters.");
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [resolvedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email.",
      });
    }

    const passwordHash = await bcrypt.hash(resolvedPassword, 10);

    const result = await pool.query(
      `
      INSERT INTO users (full_name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name, email, role, created_at
      `,
      [resolvedName, resolvedEmail, passwordHash, resolvedRole]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    return serverError(res, err, "Signup error:");
  }
});

/* =========================
   AUTH - LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const resolvedEmail = (email || "").trim().toLowerCase();
    const resolvedPassword = password || "";

    if (!resolvedEmail || !resolvedPassword) {
      return badRequest(res, "Email and password are required.");
    }

    const result = await pool.query(
      `
      SELECT id, full_name, email, password_hash, role
      FROM users
      WHERE email = $1
      `,
      [resolvedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(resolvedPassword, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    return serverError(res, err, "Login error:");
  }
});

/* =========================
   AUTH - CURRENT USER
========================= */

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, full_name, email, role, created_at
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    return serverError(res, err, "Fetch current user error:");
  }
});

/* =========================
   AUTH - FORGOT PASSWORD
   Placeholder
========================= */

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();

    if (!email) {
      return badRequest(res, "Email is required.");
    }

    return res.json({
      success: true,
      message: "If this email exists, a reset link would be sent.",
    });
  } catch (err) {
    return serverError(res, err, "Forgot password error:");
  }
});

/* =========================
   AUTH - CHANGE PASSWORD
========================= */

app.post("/api/auth/change-password", authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return badRequest(res, "Current password and new password are required.");
    }

    if (new_password.length < 8) {
      return badRequest(res, "New password must be at least 8 characters.");
    }

    const result = await pool.query(
      "SELECT id, password_hash FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    const newHash = await bcrypt.hash(new_password, 10);

    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [newHash, req.user.id]
    );

    return res.json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (err) {
    return serverError(res, err, "Change password error:");
  }
});

/* =========================
   PATIENTS - CREATE
========================= */

app.post("/api/demographics", async (req, res) => {
  try {
    const {
      full_name,
      age,
      gender,
      height_cm,
      weight_kg,
      pain_score,
      nationality,
    } = req.body;

    if (!full_name || !age || !gender) {
      return badRequest(res, "Full name, age and gender are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO demographics
      (full_name, age, gender, height_cm, weight_kg, pain_score, nationality)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        full_name.trim(),
        normalizeInt(age),
        gender.trim(),
        normalizeInt(height_cm),
        normalizeInt(weight_kg),
        normalizeInt(pain_score),
        nationality ? nationality.trim() : null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Patient saved successfully.",
      demographic: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Insert demographics error:");
  }
});

/* Alias */
app.post("/api/patients", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      full_name,
      age,
      sex,
      gender,
      height_cm,
      weight_kg,
      pain_score,
      nationality,
    } = req.body;

    const resolvedFullName =
      (full_name || `${first_name || ""} ${last_name || ""}`.trim()).trim();

    const resolvedGender = (gender || sex || "").trim();

    if (!resolvedFullName || !age || !resolvedGender) {
      return badRequest(res, "Patient name, age and gender are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO demographics
      (full_name, age, gender, height_cm, weight_kg, pain_score, nationality)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        resolvedFullName,
        normalizeInt(age),
        resolvedGender,
        normalizeInt(height_cm),
        normalizeInt(weight_kg),
        normalizeInt(pain_score),
        nationality ? nationality.trim() : null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Patient created successfully.",
      patient: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Create patient error:");
  }
});

/* =========================
   PATIENTS - LIST
========================= */

app.get("/api/patients", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM demographics
      ORDER BY patient_id DESC
    `);

    return res.json({
      success: true,
      patients: result.rows,
    });
  } catch (err) {
    return serverError(res, err, "List patients error:");
  }
});

/* =========================
   PATIENTS - GET ONE
========================= */

app.get("/api/patients/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM demographics WHERE patient_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found.",
      });
    }

    return res.json({
      success: true,
      patient: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Get patient error:");
  }
});

/* =========================
   PATIENTS - DELETE
========================= */

app.delete("/api/patients/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM demographics WHERE patient_id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found.",
      });
    }

    return res.json({
      success: true,
      message: "Patient deleted successfully.",
    });
  } catch (err) {
    return serverError(res, err, "Delete patient error:");
  }
});

/* =========================
   PATIENTS - CONSENT
   Requires demographics.consent_signed BOOLEAN
========================= */

app.patch("/api/patients/:id/consent", async (req, res) => {
  try {
    const { consent_signed } = req.body;

    const result = await pool.query(
      `
      UPDATE demographics
      SET consent_signed = $1
      WHERE patient_id = $2
      RETURNING *
      `,
      [normalizeBool(consent_signed, false), req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found.",
      });
    }

    return res.json({
      success: true,
      message: "Consent updated successfully.",
      patient: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Consent update error:");
  }
});

/* =========================
   PROFILE - GET
   Requires therapist_profiles table
========================= */

app.get("/api/profile", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM therapist_profiles WHERE user_id = $1`,
      [req.user.id]
    );

    return res.json({
      success: true,
      profile: result.rows[0] || null,
    });
  } catch (err) {
    return serverError(res, err, "Profile fetch error:");
  }
});

/* =========================
   PROFILE - SAVE
========================= */

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const {
      therapistName,
      therapistRole,
      licenseNo,
      experienceYears,
      email,
      phone,
      clinicName,
      clinicAddress,
      timezone,
      language,
      privacyEmail,
      defaultDisclaimer,
      logoDataUrl,
      stampDataUrl,
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO therapist_profiles (
        user_id,
        therapist_name,
        therapist_role,
        license_no,
        experience_years,
        email,
        phone,
        clinic_name,
        clinic_address,
        timezone,
        language,
        privacy_email,
        default_disclaimer,
        logo_data_url,
        stamp_data_url,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        therapist_name = EXCLUDED.therapist_name,
        therapist_role = EXCLUDED.therapist_role,
        license_no = EXCLUDED.license_no,
        experience_years = EXCLUDED.experience_years,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        clinic_name = EXCLUDED.clinic_name,
        clinic_address = EXCLUDED.clinic_address,
        timezone = EXCLUDED.timezone,
        language = EXCLUDED.language,
        privacy_email = EXCLUDED.privacy_email,
        default_disclaimer = EXCLUDED.default_disclaimer,
        logo_data_url = EXCLUDED.logo_data_url,
        stamp_data_url = EXCLUDED.stamp_data_url,
        updated_at = NOW()
      RETURNING *
      `,
      [
        req.user.id,
        therapistName || null,
        therapistRole || null,
        licenseNo || null,
        normalizeInt(experienceYears, null),
        email || null,
        phone || null,
        clinicName || null,
        clinicAddress || null,
        timezone || null,
        language || null,
        privacyEmail || null,
        defaultDisclaimer || null,
        logoDataUrl || null,
        stampDataUrl || null,
      ]
    );

    return res.json({
      success: true,
      message: "Profile saved successfully.",
      profile: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Profile save error:");
  }
});

/* =========================
   ARM CURL
========================= */

app.post("/api/tests/arm-curl", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      arm_used,
      repetitions,
      weight_used_kg,
      attempt_number,
      compensation_flag,
      score,
    } = req.body;

    if (!patient_id || !arm_used) {
      return badRequest(res, "patient_id and arm_used are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO arm_curl
      (patient_id, test_date, arm_used, repetitions, weight_used_kg, attempt_number, compensation_flag, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        arm_used,
        normalizeInt(repetitions, 0),
        normalizeNumber(weight_used_kg, 0),
        normalizeInt(attempt_number, 1),
        normalizeBool(compensation_flag, false),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Arm curl result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Arm curl insert error:");
  }
});

/* =========================
   BACK SCRATCH
========================= */

app.post("/api/tests/back-scratch", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      dominant_hand,
      distance_cm,
      attempt_number,
      compensation_flag,
      score,
    } = req.body;

    if (!patient_id || !dominant_hand) {
      return badRequest(res, "patient_id and dominant_hand are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO back_scratch
      (patient_id, test_date, dominant_hand, distance_cm, attempt_number, compensation_flag, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        dominant_hand,
        normalizeNumber(distance_cm, 0),
        normalizeInt(attempt_number, 1),
        normalizeBool(compensation_flag, false),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Back scratch result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Back scratch insert error:");
  }
});

/* =========================
   CHAIR SIT REACH
========================= */

app.post("/api/tests/chair-sit-reach", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      leg_assessed,
      distance_cm,
      attempt_number,
      compensation_flag,
      pain_during_test,
      score,
    } = req.body;

    if (!patient_id || !leg_assessed) {
      return badRequest(res, "patient_id and leg_assessed are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO chair_sit_reach
      (patient_id, test_date, leg_assessed, distance_cm, attempt_number, compensation_flag, pain_during_test, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        leg_assessed,
        normalizeNumber(distance_cm, 0),
        normalizeInt(attempt_number, 1),
        normalizeBool(compensation_flag, false),
        normalizeBool(pain_during_test, false),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Chair sit reach result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Chair sit reach insert error:");
  }
});

/* =========================
   CHAIR SIT STAND
========================= */

app.post("/api/tests/chair-sit-stand", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      repetitions,
      test_duration,
      attempt_number,
      compensation_flag,
      balance_issue,
      score,
    } = req.body;

    if (!patient_id) {
      return badRequest(res, "patient_id is required.");
    }

    const result = await pool.query(
      `
      INSERT INTO chair_sit_stand
      (patient_id, test_date, repetitions, test_duration, attempt_number, compensation_flag, balance_issue, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        normalizeInt(repetitions, 0),
        normalizeInt(test_duration, 0),
        normalizeInt(attempt_number, 1),
        normalizeBool(compensation_flag, false),
        normalizeBool(balance_issue, false),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Chair sit stand result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Chair sit stand insert error:");
  }
});

/* Friendly alias */
app.post("/api/tests/chair-sit-to-stand", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      repetitions,
      test_duration,
      attempt_number,
      compensation_flag,
      balance_issue,
      score,
    } = req.body;

    if (!patient_id) {
      return badRequest(res, "patient_id is required.");
    }

    const result = await pool.query(
      `
      INSERT INTO chair_sit_stand
      (patient_id, test_date, repetitions, test_duration, attempt_number, compensation_flag, balance_issue, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        normalizeInt(repetitions, 0),
        normalizeInt(test_duration, 0),
        normalizeInt(attempt_number, 1),
        normalizeBool(compensation_flag, false),
        normalizeBool(balance_issue, false),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Chair sit stand result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Chair sit stand alias insert error:");
  }
});

/* =========================
   EIGHT FOOT UP GO
========================= */

app.post("/api/tests/eight-foot-up-go", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      completion_time,
      turn_stability,
      assistive_device,
      attempt_number,
      score,
    } = req.body;

    if (!patient_id) {
      return badRequest(res, "patient_id is required.");
    }

    const result = await pool.query(
      `
      INSERT INTO eight_foot_up_go
      (patient_id, test_date, completion_time, turn_stability, assistive_device, attempt_number, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        normalizeNumber(completion_time, 0),
        normalizeBool(turn_stability, false),
        normalizeBool(assistive_device, false),
        normalizeInt(attempt_number, 1),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Eight foot up and go result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Eight foot up go insert error:");
  }
});

/* Friendly alias */
app.post("/api/tests/tug-test", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      completion_time,
      turn_stability,
      assistive_device,
      attempt_number,
      score,
    } = req.body;

    if (!patient_id) {
      return badRequest(res, "patient_id is required.");
    }

    const result = await pool.query(
      `
      INSERT INTO eight_foot_up_go
      (patient_id, test_date, completion_time, turn_stability, assistive_device, attempt_number, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        normalizeNumber(completion_time, 0),
        normalizeBool(turn_stability, false),
        normalizeBool(assistive_device, false),
        normalizeInt(attempt_number, 1),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "TUG result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "TUG alias insert error:");
  }
});

/* =========================
   SINGLE LEG STANCE
========================= */

app.post("/api/tests/single-leg-stance", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      leg_assessed,
      stance_time_sec,
      postural_sway,
      support_used,
      attempt_number,
      score,
    } = req.body;

    if (!patient_id || !leg_assessed) {
      return badRequest(res, "patient_id and leg_assessed are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO single_leg_stance
      (patient_id, test_date, leg_assessed, stance_time_sec, postural_sway, support_used, attempt_number, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        leg_assessed,
        normalizeNumber(stance_time_sec, 0),
        normalizeBool(postural_sway, false),
        normalizeBool(support_used, false),
        normalizeInt(attempt_number, 1),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Single leg stance result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Single leg stance insert error:");
  }
});

/* =========================
   GRIP STRENGTH
========================= */

app.post("/api/tests/grip-strength", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      dominant_hand,
      hand_assessed,
      grip_force_kg,
      attempt_number,
      pain_during_test,
      score,
    } = req.body;

    if (!patient_id || !dominant_hand || !hand_assessed) {
      return badRequest(res, "patient_id, dominant_hand and hand_assessed are required.");
    }

    const result = await pool.query(
      `
      INSERT INTO grip_strength
      (patient_id, test_date, dominant_hand, hand_assessed, grip_force_kg, attempt_number, pain_during_test, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        dominant_hand,
        hand_assessed,
        normalizeNumber(grip_force_kg, 0),
        normalizeInt(attempt_number, 1),
        normalizeBool(pain_during_test, false),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Grip strength result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Grip strength insert error:");
  }
});

/* =========================
   SIX MINUTE WALK
========================= */

app.post("/api/tests/six-minute-walk", async (req, res) => {
  try {
    const {
      patient_id,
      test_date,
      distance_meters,
      heart_rate_start,
      heart_rate_end,
      spo2_start,
      spo2_end,
      rest_breaks,
      attempt_number,
      score,
    } = req.body;

    if (!patient_id) {
      return badRequest(res, "patient_id is required.");
    }

    const result = await pool.query(
      `
      INSERT INTO six_minute_walk
      (patient_id, test_date, distance_meters, heart_rate_start, heart_rate_end, spo2_start, spo2_end, rest_breaks, attempt_number, score)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        normalizeInt(patient_id),
        normalizeDate(test_date),
        normalizeNumber(distance_meters, 0),
        normalizeInt(heart_rate_start, null),
        normalizeInt(heart_rate_end, null),
        normalizeInt(spo2_start, null),
        normalizeInt(spo2_end, null),
        normalizeInt(rest_breaks, 0),
        normalizeInt(attempt_number, 1),
        normalizeInt(score, null),
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Six minute walk result saved successfully.",
      result: result.rows[0],
    });
  } catch (err) {
    return serverError(res, err, "Six minute walk insert error:");
  }
});

/* =========================
   PATIENT TEST HISTORY
========================= */

app.get("/api/patients/:id/tests", async (req, res) => {
  try {
    const patientId = req.params.id;

    const result = await pool.query(
      `
      SELECT test_id, patient_id, test_date, attempt_number, score,
             'arm_curl' AS test_name,
             repetitions::text AS primary_value,
             arm_used AS assessed_side,
             compensation_flag,
             NULL::boolean AS balance_issue
      FROM arm_curl
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'back_scratch' AS test_name,
             distance_cm::text AS primary_value,
             dominant_hand AS assessed_side,
             compensation_flag,
             NULL::boolean AS balance_issue
      FROM back_scratch
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'chair_sit_reach' AS test_name,
             distance_cm::text AS primary_value,
             leg_assessed AS assessed_side,
             compensation_flag,
             NULL::boolean AS balance_issue
      FROM chair_sit_reach
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'chair_sit_stand' AS test_name,
             repetitions::text AS primary_value,
             NULL::varchar AS assessed_side,
             compensation_flag,
             balance_issue
      FROM chair_sit_stand
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'eight_foot_up_go' AS test_name,
             completion_time::text AS primary_value,
             NULL::varchar AS assessed_side,
             NULL::boolean AS compensation_flag,
             NULL::boolean AS balance_issue
      FROM eight_foot_up_go
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'single_leg_stance' AS test_name,
             stance_time_sec::text AS primary_value,
             leg_assessed AS assessed_side,
             NULL::boolean AS compensation_flag,
             postural_sway AS balance_issue
      FROM single_leg_stance
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'grip_strength' AS test_name,
             grip_force_kg::text AS primary_value,
             hand_assessed AS assessed_side,
             NULL::boolean AS compensation_flag,
             NULL::boolean AS balance_issue
      FROM grip_strength
      WHERE patient_id = $1

      UNION ALL

      SELECT test_id, patient_id, test_date, attempt_number, score,
             'six_minute_walk' AS test_name,
             distance_meters::text AS primary_value,
             NULL::varchar AS assessed_side,
             NULL::boolean AS compensation_flag,
             NULL::boolean AS balance_issue
      FROM six_minute_walk
      WHERE patient_id = $1

      ORDER BY test_date DESC, test_id DESC
      `,
      [patientId]
    );

    return res.json({
      success: true,
      tests: result.rows,
    });
  } catch (err) {
    return serverError(res, err, "Patient tests fetch error:");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});