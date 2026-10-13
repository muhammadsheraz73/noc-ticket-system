import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, EmptyState, Field, Loading, Select, TextInput } from '../components/ui.jsx';
import ClientFormModal from '../components/ClientFormModal.jsx';
import { ClientAvatar, HealthBadge } from '../components/OwnerKit.jsx';
import { formatDate, formatDateTime, formatNumber, relativeTime } from '../utils/format.js';

const FILTERS = [
  { value: '', label: 'All clients' },
  { value: 'flagged', label: 'Needs attention' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'suspended', label: 'Suspended' },
];

/** Owner-only: the companies this panel has been sold to, with their live numbers. */
export default function ClientsPage() {
  const { serverNow } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(params.get('new') ? null : undefined); // undefined = closed

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

  const closeForm = () => {
    setEditing(undefined);
    if (params.get('new')) setParams({}, { replace: true });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      if (filter === 'flagged' && !['attention', 'critical'].includes(c.health.level)) return false;
      if (filter && filter !== 'flagged' && c.health.level !== filter) return false;
      if (!q) return true;
      return [c.name, c.contactName, c.phone].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, query, filter]);

  if (loading && items.length === 0 && !error) return <Loading label="Loading clients…" />;

  const now = serverNow();

  return (
    <>
      <PageHead
        title="Clients"
        subtitle="Each client is a separate company: its logins only ever see that company's own tickets, customers, billing and network."
        actions={<button className="btn" onClick={() => setEditing(null)}>＋ New client</button>}
      />

      {error ? <Alert tone="error" title="Could not load clients">{error}</Alert> : null}

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, contact person, phone…" />
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Show">
              <Select value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div className="card__body card__body--flush">
          {visible.length === 0 ? (
            <EmptyState
              icon="🏢"
              title={items.length ? 'No clients match' : 'No clients yet'}
              message={items.length ? 'Try a different search or filter.' : 'Create the first client, then add its login.'}
              action={items.length ? null : <button className="btn" onClick={() => setEditing(null)}>＋ New client</button>}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Health</th>
                    <th className="text-right">Customers</th>
                    <th className="text-right">Open tickets</th>
                    <th className="text-right">Logins</th>
                    <th className="text-right">Employees</th>
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
                        <td className="text-right mono">{formatNumber(m.customers.total)}</td>
                        <td className="text-right mono">
                          {formatNumber(m.tickets.open)}
                          {m.tickets.overdue ? <div className="small text-danger strong">{m.tickets.overdue} overdue</div> : null}
                        </td>
                        <td className="text-right mono">{m.logins.active}<span className="muted"> / {m.logins.total}</span></td>
                        <td className="text-right mono">{formatNumber(m.employees)}</td>
                        <td className="small nowrap" title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : ''}>
                          {m.lastActiveAt ? relativeTime(m.lastActiveAt, now) : <span className="muted">never</span>}
                        </td>
                        <td className="small muted nowrap">{formatDate(client.createdAt)}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div className="table__actions">
                            <Link className="btn btn--secondary btn--sm" to={`/clients/${client._id}`}>Monitor</Link>
                            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(client)}>Edit</button>
                            <Link className="btn btn--ghost btn--sm" to={`/users?client=${client._id}`}>Logins</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ClientFormModal
        open={editing !== undefined}
        client={editing}
        onClose={closeForm}
        onSaved={(saved) => {
          const isNew = !editing;
          closeForm();
          if (isNew && saved?._id) navigate(`/clients/${saved._id}`);
          else load();
        }}
      />
    </>
  );
}
