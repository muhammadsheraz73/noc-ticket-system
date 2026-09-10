import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, ConfirmDialog, DefItem, Loading, Select } from '../components/ui.jsx';
import { INVOICE_TONE, STATUS_TONE, formatDate, formatDateTime, formatMoney } from '../utils/format.js';

const STATUSES = ['Draft', 'Unpaid', 'Paid', 'Cancelled'];

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { canManageInvoices, isAdmin } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: response } = await api.get(`/invoices/${id}`);
      setData(response);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /**
   * The PDF endpoint is authenticated, so it is fetched as a blob through
   * axios (which attaches the token) rather than linked to directly.
   */
  const fetchPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      setPdfUrl(url);
      return url;
    } catch (err) {
      toast.error('Could not generate the PDF', errorMessage(err));
      return '';
    } finally {
      setPdfLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    if (!data) return undefined;
    let created = '';
    fetchPdf().then((url) => { created = url; });
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?._id ?? data?.invoice?._id]);

  const download = async () => {
    const url = pdfUrl || (await fetchPdf());
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.invoice.invoiceNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success('Invoice downloaded', `${data.invoice.invoiceNumber}.pdf`);
  };

  const print = async () => {
    const url = pdfUrl || (await fetchPdf());
    if (!url) return;
    const win = window.open(url, '_blank');
    if (win) win.addEventListener('load', () => win.print());
    else toast.warning('Pop-up blocked', 'Allow pop-ups to print the invoice.');
  };

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await api.patch(`/invoices/${id}/status`, { status });
      toast.success('Invoice status updated', status);
      await load();
    } catch (err) {
      toast.error('Could not update the status', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/invoices/${id}`);
      toast.success('Invoice archived');
      setDeleting(false);
      await load();
    } catch (err) {
      toast.error('Could not archive the invoice', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading invoice…" />;
  if (error) return <Alert tone="error" title="Invoice not available">{error}</Alert>;

  const { invoice, ticket, customer } = data;

  return (
    <>
      <PageHead
        back="/invoices"
        title={invoice.invoiceNumber}
        subtitle={`${invoice.customerName} · Ticket TID ${invoice.ticketNumber}`}
        actions={
          <>
            <button className="btn btn--secondary" onClick={print} disabled={pdfLoading}>🖨 Print</button>
            <button className="btn" onClick={download} disabled={pdfLoading}>
              {pdfLoading ? <span className="spinner" /> : null} ⭳ Download PDF
            </button>
          </>
        }
      />

      {invoice.isDeleted ? <Alert tone="warn" title="Archived">This invoice has been soft deleted.</Alert> : null}

      <div className="grid grid--detail">
        <div className="card">
          <div className="card__head">
            <h2>Invoice preview</h2>
            <div className="card__head-actions"><Badge tone={INVOICE_TONE[invoice.status]}>{invoice.status}</Badge></div>
          </div>
          <div className="card__body">
            {pdfUrl ? (
              <iframe
                title={`Invoice ${invoice.invoiceNumber}`}
                src={pdfUrl}
                style={{ width: '100%', height: 620, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}
              />
            ) : (
              <Loading label="Generating PDF preview…" />
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head"><h3>Details</h3></div>
            <div className="card__body">
              <div className="deflist">
                <DefItem label="Invoice number" value={invoice.invoiceNumber} mono />
                <DefItem label="Ticket (TID)">
                  <Link to={`/tickets/${invoice.ticketNumber}`} className="tid">{invoice.ticketNumber}</Link>
                </DefItem>
                <DefItem label="Customer">
                  <Link to={`/customers/${invoice.customerReferenceNumber}`}>
                    {invoice.customerReferenceNumber} — {invoice.customerName}
                  </Link>
                </DefItem>
                <DefItem label="Issue date" value={formatDate(invoice.issueDate)} />
                <DefItem label="Due date" value={formatDate(invoice.dueDate)} />
                <DefItem label="Created by" value={invoice.createdByName} />
                <DefItem label="Created" value={formatDateTime(invoice.createdAt)} />
                {invoice.notes ? <DefItem label="Notes" value={invoice.notes} /> : null}
              </div>

              {canManageInvoices ? (
                <div style={{ marginTop: 16 }}>
                  <div className="deflist__label" style={{ marginBottom: 6 }}>Change status</div>
                  <Select value={invoice.status} disabled={busy} onChange={(event) => changeStatus(event.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </div>
              ) : null}

              {isAdmin && !invoice.isDeleted ? (
                <button className="btn btn--ghost btn--sm text-danger" style={{ marginTop: 12 }} onClick={() => setDeleting(true)}>
                  Archive invoice
                </button>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h3>Amounts</h3></div>
            <div className="card__body">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
                  <tbody>
                    {invoice.items.map((item, index) => (
                      <tr key={index}>
                        <td>{item.description}</td>
                        <td className="text-right num">{item.quantity}</td>
                        <td className="text-right num">{formatMoney(item.rate, invoice.currency)}</td>
                        <td className="text-right num strong">{formatMoney(item.amount, invoice.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="totals" style={{ marginTop: 14 }}>
                <div className="totals__row"><span>Subtotal</span><span className="num">{formatMoney(invoice.subtotal, invoice.currency)}</span></div>
                {invoice.discountAmount > 0 ? (
                  <div className="totals__row">
                    <span>Discount{invoice.discountType === 'percent' ? ` (${invoice.discountValue}%)` : ''}</span>
                    <span className="num">− {formatMoney(invoice.discountAmount, invoice.currency)}</span>
                  </div>
                ) : null}
                {invoice.taxAmount > 0 ? (
                  <div className="totals__row"><span>Tax ({invoice.taxPercent}%)</span><span className="num">{formatMoney(invoice.taxAmount, invoice.currency)}</span></div>
                ) : null}
                <div className="totals__row totals__row--total"><span>Total</span><span className="num">{formatMoney(invoice.total, invoice.currency)}</span></div>
              </div>
            </div>
          </div>

          {ticket ? (
            <div className="card">
              <div className="card__head">
                <h3>Linked ticket</h3>
                <div className="card__head-actions">
                  <Link className="btn btn--secondary btn--sm" to={`/tickets/${ticket.ticketNumber}`}>Open →</Link>
                </div>
              </div>
              <div className="card__body">
                <div className="deflist">
                  <DefItem label="Issue type" value={ticket.issueType} />
                  <DefItem label="Status"><Badge tone={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></DefItem>
                  <DefItem label="Created" value={formatDateTime(ticket.createdAt)} />
                  <DefItem label="Assigned to" value={ticket.assignedToName} />
                  <DefItem label="Remarks" value={ticket.remarks} />
                </div>
                {customer ? <div className="small muted" style={{ marginTop: 8 }}>Connected from {customer.connectedFrom}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        title="Archive this invoice?"
        message={`${invoice.invoiceNumber} will be soft deleted and hidden from listings. The action is audited.`}
        confirmLabel="Archive invoice"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
