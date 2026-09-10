import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, EmptyState, Field, Pagination, Select, Stat, TableSkeleton, TextInput } from '../components/ui.jsx';
import { INVOICE_TONE, formatDate, formatMoney } from '../utils/format.js';

const STATUSES = ['Draft', 'Unpaid', 'Paid', 'Cancelled'];

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { canManageInvoices } = useAuth();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState({ items: [], pagination: null, totals: [], loading: true, error: '' });
  const [query, setQuery] = useState(params.get('q') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/invoices', {
        params: { q: query || undefined, status: status || undefined, page, limit: 20 },
      });
      setState({
        items: data.items,
        pagination: data.pagination,
        totals: data.totalsByStatus || [],
        loading: false,
        error: '',
      });
    } catch (error) {
      setState({ items: [], pagination: null, totals: [], loading: false, error: errorMessage(error) });
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

  const totalFor = (name) => state.totals.find((t) => t._id === name);

  return (
    <>
      <PageHead
        title="Invoices"
        subtitle="Each invoice is raised from a Ticket ID and linked to both the ticket and the customer."
        actions={canManageInvoices ? <Link className="btn" to="/invoices/new">＋ Create Invoice</Link> : null}
      />

      {state.error ? <Alert tone="error" title="Could not load invoices">{state.error}</Alert> : null}

      <div className="stack">
        <div className="grid grid--stats">
          {STATUSES.map((name) => {
            const entry = totalFor(name);
            return (
              <Stat
                key={name}
                label={name}
                value={entry?.count ?? 0}
                hint={entry ? formatMoney(entry.amount) : formatMoney(0)}
                tone={name === 'Paid' ? 'ok' : name === 'Unpaid' ? 'warn' : name === 'Cancelled' ? 'danger' : ''}
                onClick={() => { setStatus(name); setPage(1); }}
              />
            );
          })}
        </div>

        <div className="card">
          <div className="filters">
            <div className="filters__item filters__item--grow">
              <Field label="Search">
                <TextInput
                  placeholder="Invoice number, TID, customer…"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                />
              </Field>
            </div>
            <div className="filters__item">
              <Field label="Status">
                <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
            </div>
            {query || status ? (
              <button className="btn btn--ghost btn--sm" onClick={() => { setQuery(''); setStatus(''); setPage(1); }}>Clear</button>
            ) : null}
          </div>

          <div className="card__body card__body--flush">
            {state.loading ? (
              <TableSkeleton rows={6} cols={7} />
            ) : state.items.length === 0 ? (
              <EmptyState
                icon="🧾"
                title="No invoices found"
                message={query || status ? 'No invoice matches these filters.' : 'Create an invoice from a Ticket ID.'}
                action={canManageInvoices ? <Link className="btn" to="/invoices/new">＋ Create Invoice</Link> : null}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice #</th><th>TID</th><th>Customer</th><th>Issue Date</th>
                      <th>Due Date</th><th>Status</th><th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.map((invoice) => (
                      <tr key={invoice._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${invoice._id}`)}>
                        <td className="mono strong">{invoice.invoiceNumber}</td>
                        <td><span className="tid">{invoice.ticketNumber}</span></td>
                        <td>
                          <div className="strong">{invoice.customerName}</div>
                          <div className="small muted">{invoice.customerReferenceNumber}</div>
                        </td>
                        <td className="nowrap small">{formatDate(invoice.issueDate)}</td>
                        <td className="nowrap small">{formatDate(invoice.dueDate)}</td>
                        <td><Badge tone={INVOICE_TONE[invoice.status]}>{invoice.status}</Badge></td>
                        <td className="text-right num strong">{formatMoney(invoice.total, invoice.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <Pagination pagination={state.pagination} onChange={setPage} />
        </div>
      </div>
    </>
  );
}
