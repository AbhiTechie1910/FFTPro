export const APP_CONFIG = {
  API_BASE_URL: "http://127.0.0.1:5000",

  STORAGE_KEYS: {
    ACTIVE_PATIENT: "fft_active_patient_v1",
    ACTIVE_SESSION: "fft_active_session_v1",
    PENDING_RESULTS: "fft_pending_results_v1",
    AUTH_USER: "fft_auth_user_v1",
  },

  CAMERA: {
    DEFAULT_WIDTH: 640,
    DEFAULT_HEIGHT: 480,
    FALLBACK_WIDTH: 480,
    FALLBACK_HEIGHT: 360,
    FACING_MODE: "user",
  },

  TEST: {
    DEFAULT_COUNTDOWN_SECONDS: 3,
    UI_UPDATE_INTERVAL_MS: 100,
    MIN_STATE_HOLD_MS: 250,
    MAX_SNAPSHOTS_PER_TEST: 5,
  },

  DEBUG: true,
};