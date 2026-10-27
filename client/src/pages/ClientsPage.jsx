import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, EmptyState, Loading, TextInput } from '../components/ui.jsx';
import ClientFormModal from '../components/ClientFormModal.jsx';
import { ClientAvatar, HealthBadge } from '../components/OwnerKit.jsx';
import { formatDate, formatDateTime, formatNumber, relativeTime } from '../utils/format.js';

/** The four ways the owner slices the client list. */
const FILTERS = [
  { value: '', label: 'All', test: () => true },
  { value: 'active', label: 'Active', test: (c) => c.isActive },
  { value: 'attention', label: 'Need attention', test: (c) => ['attention', 'critical'].includes(c.health.level) },
  { value: 'suspended', label: 'Suspended', test: (c) => !c.isActive },
];

/** Owner-only: every company the panel has been sold to. One row per client; open it to manage everything. */
export default function ClientsPage() {
  const { serverNow } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const filter = FILTERS.some((f) => f.value === params.get('show')) ? params.get('show') : '';
  const [creating, setCreating] = useState(Boolean(params.get('new')));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/owner/overview', { params: { days: 30 } });
      setItems(data.clients);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setFilter = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('show', value); else next.delete('show');
    next.delete('new');
    setParams(next, { replace: true });
  };

  const closeForm = () => {
    setCreating(false);
    if (params.get('new')) {
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.value === filter).test;
    return items
      .filter(test)
      .filter((c) => !q || [c.name, c.contactName, c.phone].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query, filter]);

  if (loading && items.length === 0 && !error) return <Loading label="Loading clients…" />;

  const now = serverNow();

  return (
    <>
      <PageHead
        title="Clients"
        subtitle="Every company using your panel. Each one only sees its own data. Click a client to manage it."
        actions={<button className="btn" onClick={() => setCreating(true)}>＋ New client</button>}
      />

      {error ? <Alert tone="error" title="Could not load clients">{error}</Alert> : null}

      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="o-chips" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`o-chip${filter === f.value ? ' is-active' : ''}`}
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                <span className="o-chip__count">{items.filter(f.test).length}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: '0 1 320px', minWidth: 220 }}>
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search company, contact or phone…"
              aria-label="Search clients"
            />
          </div>
        </div>

        <div className="card">
          <div className="card__body card__body--flush">
            {visible.length === 0 ? (
              <EmptyState
                icon="🏢"
                title={items.length ? 'No clients match' : 'No clients yet'}
                message={items.length ? 'Try a different search or filter.' : 'Create the first client, then add its login.'}
                action={items.length ? null : <button className="btn" onClick={() => setCreating(true)}>＋ New client</button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Status</th>
                      <th className="text-right">Logins</th>
                      <th className="text-right">Customers</th>
                      <th className="text-right">Open tickets</th>
                      <th>Last active</th>
                      <th>Client since</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((client) => {
                      const m = client.metrics;
                      return (
                        <tr key={client._id} className="clickable-row" onClick={() => navigate(`/clients/${client._id}`)}>
                          <td>
                            <div className="client-cell">
                              <ClientAvatar client={client} />
                              <div style={{ minWidth: 0 }}>
                                <div className="strong">{client.name}</div>
                                <div className="small muted">
                                  {[client.contactName, client.phone].filter(Boolean).join(' · ') || 'No contact saved'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td><HealthBadge health={client.health} /></td>
                          <td className="text-right">{m.logins.active}</td>
                          <td className="text-right">{formatNumber(m.customers.total)}</td>
                          <td className="text-right">
                            {formatNumber(m.tickets.open)}
                            {m.tickets.overdue ? <div className="small text-danger strong">{m.tickets.overdue} overdue</div> : null}
                          </td>
                          <td className="small nowrap" title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : ''}>
                            {m.lastActiveAt ? relativeTime(m.lastActiveAt, now) : <span className="muted">never</span>}
                          </td>
                          <td className="small muted nowrap">{formatDate(client.createdAt)}</td>
                          <td className="text-right"><span className="btn btn--secondary btn--sm">Open →</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <ClientFormModal
        open={creating}
        client={null}
        onClose={closeForm}
        onSaved={(saved) => {
          closeForm();
          if (saved?._id) navigate(`/clients/${saved._id}?tab=logins`);
          else load();
        }}
      />
    </>
  );
}
