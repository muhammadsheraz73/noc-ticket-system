import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Calculator, FileText, Wallet } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Kpi from '../components/Kpi.jsx';
import { Alert, EmptyState, Field, Pagination, TableSkeleton, TextInput } from '../components/ui.jsx';
import { formatDate, formatMoney, formatNumber } from '../utils/format.js';
import { downloadQuotationPdf } from '../utils/quotationPdf.js';

/** Every quotation this client has made — open one, or download its PDF straight from the list. */
export default function QuotationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState({ items: [], pagination: null, summary: null, loading: true, error: '' });
  const [query, setQuery] = useState(params.get('q') || '');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/quotations', { params: { q: query || undefined, page, limit: 20 } });
      setState({ items: data.items, pagination: data.pagination, summary: data.summary, loading: false, error: '' });
    } catch (error) {
      setState((s) => ({ ...s, items: [], loading: false, error: errorMessage(error) }));
    }
  }, [query, page]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 320 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    setParams(query ? { q: query } : {}, { replace: true });
  }, [query, setParams]);

  const download = async (event, q) => {
    event.stopPropagation();
    setDownloading(q._id);
    try {
      await downloadQuotationPdf(q);
    } catch (err) {
      toast.error('Could not download the PDF', errorMessage(err));
    } finally {
      setDownloading('');
    }
  };

  const s = state.summary;
  const whole = (v) => formatNumber(Math.round(v || 0));

  return (
    <>
      <PageHead
        title="Quotations"
        subtitle="Make a quotation and download it as a PDF on your own letterhead."
        actions={<Link className="btn" to="/quotations/new">＋ New Quotation</Link>}
      />

      {state.error ? <Alert tone="error" title="Could not load quotations">{state.error}</Alert> : null}

      <div className="kpi-row">
        <Kpi icon={FileText} tone="brand" label="Total quotations" value={formatNumber(s?.total.count)} hint="All time" />
        <Kpi icon={CalendarDays} tone="info" label="This month" value={formatNumber(s?.thisMonth.count)} hint={`PKR ${whole(s?.thisMonth.value)} quoted`} />
        <Kpi icon={Wallet} tone="ok" label="Total quoted" prefix="PKR" value={whole(s?.total.value)} hint="Value of all quotations" />
        <Kpi icon={Calculator} tone="muted" label="Average quotation" prefix="PKR" value={whole(s?.average)} hint="Per quotation" />
      </div>

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                placeholder="Quotation #, client, company, subject, customer ID…"
              />
            </Field>
          </div>
        </div>

        <div className="card__body card__body--flush">
          {state.loading && !state.items.length ? (
            <TableSkeleton rows={6} cols={6} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="📄"
              title={query ? 'No quotations found' : 'No quotations yet'}
              message={query ? 'Try a different search.' : 'Create your first quotation — it downloads as a PDF on your letterhead.'}
              action={query ? null : <Link className="btn" to="/quotations/new">＋ New Quotation</Link>}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quotation</th><th>Client</th><th>Subject</th><th>Date</th><th>Valid until</th>
                    <th className="text-right">Total</th><th />
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((q) => (
                    <tr key={q._id} className="clickable-row" onClick={() => navigate(`/quotations/${q._id}`)}>
                      <td className="mono strong nowrap">{q.quoteNumber}</td>
                      <td>
                        <div className="strong">{q.clientName}</div>
                        <div className="small muted">
                          {[q.clientCompany, q.customerReferenceNumber ? `ID ${q.customerReferenceNumber}` : ''].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>
                      <td className="small">{q.subject || <span className="muted">—</span>}</td>
                      <td className="small nowrap">{formatDate(q.issueDate)}</td>
                      <td className="small nowrap">{formatDate(q.validUntil)}</td>
                      <td className="text-right nowrap strong">{formatMoney(q.total, q.currency)}</td>
                      <td>
                        <div className="table__actions">
                          <button className="btn btn--secondary btn--sm" onClick={(e) => download(e, q)} disabled={downloading === q._id}>
                            {downloading === q._id ? <span className="spinner spinner--dark" /> : '⭳'} PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {state.pagination?.pages > 1 ? (
          <div className="card__foot"><Pagination pagination={state.pagination} onChange={setPage} /></div>
        ) : null}
      </div>
    </>
  );
}
