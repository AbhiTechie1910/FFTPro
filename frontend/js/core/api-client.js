import { APP_CONFIG } from "../app/constants.js";
import { debug } from "../utils/debug.js";

const BASE_URL = APP_CONFIG.API_BASE_URL;

async function parseResponse(res) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json();
  }

  const text = await res.text();
  return { message: text };
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;

  const config = {
    method: options.method || "GET",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    body:
      options.body instanceof FormData
        ? options.body
        : options.body
        ? JSON.stringify(options.body)
        : undefined,
  };

  try {
    debug.log(`${config.method} ${url}`);

    const response = await fetch(url, config);
    const data = await parseResponse(response);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: data?.message || "Request failed",
        data: data || null,
      };
    }

    return {
      ok: true,
      status: response.status,
      message: data?.message || "Success",
      data: data || null,
    };
  } catch (error) {
    debug.error("API request failed:", error);

    return {
      ok: false,
      status: 0,
      message: error.message || "Network error",
      data: null,
    };
  }
}

export const apiClient = {
  get(path, headers = {}) {
    return request(path, { method: "GET", headers });
  },

  post(path, body, headers = {}) {
    return request(path, { method: "POST", body, headers });
  },

  put(path, body, headers = {}) {
    return request(path, { method: "PUT", body, headers });
  },

  patch(path, body, headers = {}) {
    return request(path, { method: "PATCH", body, headers });
  },

  delete(path, headers = {}) {
    return request(path, { method: "DELETE", headers });
  },

  upload(path, formData, headers = {}) {
    return request(path, { method: "POST", body: formData, headers });
  },
};