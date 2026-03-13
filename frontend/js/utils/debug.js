import { APP_CONFIG } from "../app/constants.js";

function shouldLog() {
  return Boolean(APP_CONFIG.DEBUG);
}

export const debug = {
  log(...args) {
    if (!shouldLog()) return;
    console.log("[FFTPro]", ...args);
  },

  warn(...args) {
    if (!shouldLog()) return;
    console.warn("[FFTPro]", ...args);
  },

  error(...args) {
    if (!shouldLog()) return;
    console.error("[FFTPro]", ...args);
  },

  table(data) {
    if (!shouldLog()) return;
    console.table(data);
  },

  group(label) {
    if (!shouldLog()) return;
    console.group(`[FFTPro] ${label}`);
  },

  groupEnd() {
    if (!shouldLog()) return;
    console.groupEnd();
  },
};