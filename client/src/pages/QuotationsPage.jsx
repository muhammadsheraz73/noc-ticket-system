import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleCheck, FileText, Hourglass, Trophy } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { PageHead } from '../components/Layout.jsx';
import Kpi from '../components/Kpi.jsx';
import { Alert, Badge, EmptyState, Field, Pagination, Select, TableSkeleton, TextInput } from '../components/ui.jsx';
import { QUOTATION_TONE, formatDate, formatMoney, formatNumber } from '../utils/format.js';

const STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];

/** Every quotation this client has issued, with how many turned into business. */
export default function QuotationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState({ items: [], pagination: null, summary: null, loading: true, error: '' });
  const [query, setQuery] = useState(params.get('q') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/quotations', { params: { q: query || undefined, status: status || undefined, page, limit: 20 } });
      setState({ items: data.items, pagination: data.pagination, summary: data.summary, loading: false, error: '' });
    } catch (error) {
      setState((s) => ({ ...s, items: [], loading: false, error: errorMessage(error) }));
    }
  }, [query, status, page]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 320 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (status) next.set('status', status);
    setParams(next, { replace: true });
  }, [query, status, setParams]);

  const s = state.summary;
  const short = (v) => formatNumber(Math.round(v || 0));
  const toggle = (value) => { setStatus((cur) => (cur === value ? '' : value)); setPage(1); };

  return (
    <>
      <PageHead
        title="Quotations"
        subtitle="Price quotes for customers and new prospects — downloaded on your own letterhead."
        actions={<Link className="btn" to="/quotations/new">＋ New Quotation</Link>}
      />

      {state.error ? <Alert tone="error" title="Could not load quotations">{state.error}</Alert> : null}

      <div className="kpi-row">
        <Kpi icon={FileText} tone="brand" label="Total quotations" value={formatNumber(s?.total)} hint="All time" />
        <Kpi
          icon={Hourglass}
          tone="info"
          label="Awaiting reply"
          prefix="PKR"
          value={short(s?.open.value)}
          hint={`${formatNumber(s?.open.count)} draft or sent, still valid`}
        />
        <Kpi
          icon={CircleCheck}
          tone="ok"
          label="Accepted"
          prefix="PKR"
          value={short(s?.accepted.value)}
          hint={`${formatNumber(s?.accepted.count)} quotation(s) won · click to view`}
          active={status === 'Accepted'}
          onClick={() => toggle('Accepted')}
        />
        <Kpi
          icon={Trophy}
          tone={s?.winRate === null || s?.winRate === undefined ? 'muted' : s.winRate >= 50 ? 'ok' : 'danger'}
          label="Win rate"
          value={s?.winRate === null || s?.winRate === undefined ? '—' : `${s.winRate}%`}
          hint={s?.expired.count ? `${s.expired.count} expired without a reply` : 'Accepted out of decided'}
        />
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
          <div className="filters__item">
            <Field label="Status">
              <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="">All statuses</option>
                {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div className="card__body card__body--flush">
          {state.loading && !state.items.length ? (
            <TableSkeleton rows={6} cols={7} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="📄"
              title={query || status ? 'No quotations found' : 'No quotations yet'}
              message={query || status ? 'Try a different search or status.' : 'Create your first quotation — it downloads as a PDF on your letterhead.'}
              action={query || status ? null : <Link className="btn" to="/quotations/new">＋ New Quotation</Link>}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quotation</th><th>Client</th><th>Subject</th><th>Date</th><th>Valid until</th>
                    <th className="text-right">Total</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((q) => (
                    <tr key={q._id} className="clickable-row" onClick={() => navigate(`/quotations/${q._id}`)}>
                      <td className="mono strong nowrap">{q.quoteNumber}</td>
                      <td>
                        <div className="strong">{q.clientName}</div>
                        <div className="small muted">
                          {[q.clientCompany, q.customerReferenceNumber ? `ID ${q.customerReferenceNumber}` : ''].filter(Boolean).join(' · ') || 'Prospect'}
                        </div>
                      </td>
                      <td className="small">{q.subject || <span className="muted">—</span>}</td>
                      <td className="small nowrap">{formatDate(q.issueDate)}</td>
                      <td className={`small nowrap${q.isExpired ? ' text-danger' : ''}`}>{formatDate(q.validUntil)}</td>
                      <td className="text-right nowrap strong">{formatMoney(q.total, q.currency)}</td>
                      <td><Badge tone={QUOTATION_TONE[q.displayStatus]} dot>{q.displayStatus}</Badge></td>
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
