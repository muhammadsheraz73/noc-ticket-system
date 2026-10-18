import axios from 'axios';

export const TOKEN_KEY = 'noc.token';
const SIGNOUT_REASON_KEY = 'noc.signout-reason';

/**
 * The sign-in lives in sessionStorage: each browser tab signs in on its own,
 * and closing the tab ends the session. (Wrapped in try/catch — storage can
 * be unavailable in locked-down browsers.)
 */
export const tokenStore = {
  get() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(token) { try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

// Sign-ins used to be kept in localStorage and shared by every tab — drop any left over.
try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }

/** Why the user was signed out, shown once on the login page. */
export const signOutReason = {
  set(reason) { try { sessionStorage.setItem(SIGNOUT_REASON_KEY, reason); } catch { /* ignore */ } },
  take() {
    try {
      const reason = sessionStorage.getItem(SIGNOUT_REASON_KEY);
      sessionStorage.removeItem(SIGNOUT_REASON_KEY);
      return reason;
    } catch { return null; }
  },
};

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Session expiry is handled once, here, rather than in every page. */
let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => {
    // The server renews the token while the user is active (sliding session).
    const renewed = response.headers?.['x-session-token'];
    if (renewed && tokenStore.get()) tokenStore.set(renewed);
    return response;
  },
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    if (status === 401 && !url.includes('/auth/login')) {
      if (tokenStore.get()) signOutReason.set('expired');
      tokenStore.clear();
      if (onUnauthorized) onUnauthorized();
    }
    return Promise.reject(error);
  },
);

/** Turn any Axios/API failure into a single readable sentence. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (data?.details?.length) {
    return data.details.map((d) => `${d.field}: ${d.message}`).join(' · ');
  }
  if (data?.message) return data.message;
  if (error?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (error?.message === 'Network Error') {
    return 'Cannot reach the API server. Is the backend running on port 5000?';
  }
  return error?.message || fallback;
}

/** Field-level errors keyed by field name, for inline form validation. */
export function fieldErrors(error) {
  const details = error?.response?.data?.details;
  if (!Array.isArray(details)) return {};
  return details.reduce((acc, d) => {
    if (d.field && !acc[d.field]) acc[d.field] = d.message;
    return acc;
  }, {});
}

export default api;
