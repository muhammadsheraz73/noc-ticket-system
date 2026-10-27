import api from '../api/client.js';

/**
 * Fetch a file from the API (it needs the auth token, so a plain link will
 * not do) and save it under the name the server gives in Content-Disposition.
 */
export async function downloadFromApi(path, fallbackName, params) {
  const response = await api.get(path, { params, responseType: 'blob' });
  const header = response.headers['content-disposition'] || '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A failed blob request carries its JSON error as a Blob — read the message out of it. */
export async function blobError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message || fallback;
    } catch {
      return fallback;
    }
  }
  return error?.response?.data?.message || error?.message || fallback;
}
