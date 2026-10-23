import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import PdfPreview from '../components/PdfPreview.jsx';
import { Alert, ConfirmDialog, DefItem, Loading } from '../components/ui.jsx';
import { formatDate, formatMoney } from '../utils/format.js';
import { saveQuotationPdf } from '../utils/quotationPdf.js';

/** One quotation: the PDF exactly as it downloads, with edit, duplicate and delete. */
export default function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const [quotation, setQuotation] = useState(null);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/quotations/${id}`);
      setQuotation(data.quotation);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Re-render the PDF whenever the quotation changes.
  useEffect(() => {
    if (!quotation) return;
    let cancelled = false;
    setPdfLoading(true);
    api.get(`/quotations/${id}/pdf`, { responseType: 'blob' })
      .then(async (res) => { if (!cancelled) setPdf(new Uint8Array(await res.data.arrayBuffer())); })
      .catch((err) => { if (!cancelled) toast.error('Could not generate the PDF', errorMessage(err)); })
      .finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => { cancelled = true; };
  }, [id, quotation?.updatedAt, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = () => { if (pdf) saveQuotationPdf(pdf, quotation); };

  const duplicate = async () => {
    setBusy('duplicate');
    try {
      const { data } = await api.post(`/quotations/${id}/duplicate`);
      toast.success('Duplicated as a new draft', data.quotation.quoteNumber);
      navigate(`/quotations/${data.quotation._id}/edit`);
    } catch (err) {
      toast.error('Could not duplicate', errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await api.delete(`/quotations/${id}`);
      toast.success('Quotation deleted', quotation.quoteNumber);
      navigate('/quotations');
    } catch (err) {
      toast.error('Could not delete', errorMessage(err));
      setBusy('');
    }
  };

  if (error && !quotation) {
    return (
      <>
        <PageHead title="Quotation" back="/quotations" />
        <Alert tone="error" title="Could not load this quotation">{error}</Alert>
      </>
    );
  }
  if (!quotation) return <Loading label="Loading quotation…" />;

  const q = quotation;

  return (
    <>
      <PageHead
        back="/quotations"
        title={q.quoteNumber}
        subtitle={[q.clientName, q.subject].filter(Boolean).join(' · ')}
        actions={
          <>
            <button className="btn" onClick={download} disabled={!pdf}>
              {pdf ? '⭳' : <span className="spinner" />} Download PDF
            </button>
            <Link className="btn btn--secondary" to={`/quotations/${id}/edit`}>Edit</Link>
            <button className="btn btn--secondary" onClick={duplicate} disabled={Boolean(busy)}>
              {busy === 'duplicate' ? <span className="spinner spinner--dark" /> : null} Duplicate
            </button>
          </>
        }
      />

      <div className="grid grid--detail">
        <div className="card">
          <div className="card__head">
            <h2>Preview</h2>
            <span className="small muted">Exactly what downloads</span>
          </div>
          <div className="card__body" style={{ background: 'var(--bg)' }}>
            <PdfPreview bytes={pdf} loading={pdfLoading && !pdf} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head"><h3>Summary</h3></div>
            <div className="card__body">
              <div className="deflist">
                <DefItem label="Client" value={q.clientName} />
                <DefItem label="Company" value={q.clientCompany} />
                <DefItem label="Customer ID" value={q.customerReferenceNumber || 'Prospect'} mono />
                <DefItem label="Phone" value={q.clientPhone} mono />
                <DefItem label="Date" value={formatDate(q.issueDate)} />
                <DefItem label="Valid until" value={formatDate(q.validUntil)} />
                <DefItem label="Items" value={String(q.items.length)} />
                <DefItem label="Prepared by" value={q.createdByName} />
              </div>
              <div className="totals" style={{ marginTop: 14 }}>
                <div className="totals__row"><span>Subtotal</span><span className="num">{formatMoney(q.subtotal, q.currency)}</span></div>
                {q.discountAmount > 0 ? (
                  <div className="totals__row totals__row--discount">
                    <span>Discount{q.discountType === 'percent' ? ` (${q.discountValue}%)` : ''}</span>
                    <span className="num">− {formatMoney(q.discountAmount, q.currency)}</span>
                  </div>
                ) : null}
                {q.taxAmount > 0 ? <div className="totals__row"><span>Sales tax ({q.taxPercent}%)</span><span className="num">{formatMoney(q.taxAmount, q.currency)}</span></div> : null}
                <div className="totals__row totals__row--total"><span>Total</span><span className="num">{formatMoney(q.total, q.currency)}</span></div>
              </div>
            </div>
            {isAdmin ? (
              <div className="card__foot">
                <button className="btn btn--ghost btn--sm text-danger" onClick={() => setDeleting(true)}>Delete quotation</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        title={`Delete ${q.quoteNumber}?`}
        message="It will disappear from the quotation list. Its number is not reused."
        confirmLabel="Delete"
        busy={busy === 'delete'}
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
