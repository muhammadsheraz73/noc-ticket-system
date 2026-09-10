import axios from 'axios';

export const TOKEN_KEY = 'noc.token';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Session expiry is handled once, here, rather than in every page. */
let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
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
