import { APP_CONFIG } from "../app/constants.js";
import { debug } from "../utils/debug.js";

const { STORAGE_KEYS } = APP_CONFIG;

function safeParse(json, fallback = null) {
  try {
    return JSON.parse(json);
  } catch (error) {
    debug.warn("Failed to parse storage JSON:", error);
    return fallback;
  }
}

export const storageManager = {
  get(key, fallback = null) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return safeParse(raw, fallback);
  },

  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  clearAll() {
    localStorage.clear();
  },

  getActivePatient() {
    return this.get(STORAGE_KEYS.ACTIVE_PATIENT, null);
  },

  setActivePatient(patient) {
    this.set(STORAGE_KEYS.ACTIVE_PATIENT, patient);
  },

  clearActivePatient() {
    this.remove(STORAGE_KEYS.ACTIVE_PATIENT);
  },

  getActiveSession() {
    return this.get(STORAGE_KEYS.ACTIVE_SESSION, null);
  },

  setActiveSession(session) {
    this.set(STORAGE_KEYS.ACTIVE_SESSION, session);
  },

  clearActiveSession() {
    this.remove(STORAGE_KEYS.ACTIVE_SESSION);
  },

  getPendingResults() {
    return this.get(STORAGE_KEYS.PENDING_RESULTS, []);
  },

  setPendingResults(results) {
    this.set(STORAGE_KEYS.PENDING_RESULTS, results);
  },

  pushPendingResult(result) {
    const current = this.getPendingResults();
    current.push(result);
    this.setPendingResults(current);
  },

  clearPendingResults() {
    this.remove(STORAGE_KEYS.PENDING_RESULTS);
  },

  getAuthUser() {
    return this.get(STORAGE_KEYS.AUTH_USER, null);
  },

  setAuthUser(user) {
    this.set(STORAGE_KEYS.AUTH_USER, user);
  },

  clearAuthUser() {
    this.remove(STORAGE_KEYS.AUTH_USER);
  },
};