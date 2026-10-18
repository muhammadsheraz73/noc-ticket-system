import api from '../api/client.js';

/** Fetch a quotation's PDF (the endpoint needs the auth token) and save it. */
export async function downloadQuotationPdf(quotation) {
  const response = await api.get(`/quotations/${quotation._id}/pdf`, { params: { download: true }, responseType: 'blob' });
  saveQuotationPdf(new Uint8Array(await response.data.arrayBuffer()), quotation);
}

/** Save already-fetched PDF bytes as `QT-2026-0001 - Client Name.pdf`. */
export function saveQuotationPdf(bytes, quotation) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  const client = String(quotation.clientName || '').replace(/[\\/:*?"<>|]/g, '').trim();
  link.download = `${quotation.quoteNumber}${client ? ` - ${client}` : ''}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
