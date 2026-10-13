import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, EmptyState, Field, Loading, Pagination, Select } from '../components/ui.jsx';
import { ActivityFeed } from '../components/OwnerKit.jsx';

const ENTITY_TYPES = [
  { value: '', label: 'Everything' },
  { value: 'Ticket', label: 'Tickets' },
  { value: 'Customer', label: 'Customers' },
  { value: 'Invoice', label: 'Invoices' },
  { value: 'User', label: 'Sign-ins & logins' },
  { value: 'FieldTeam', label: 'Employees' },
  { value: 'InventoryItem', label: 'Inventory' },
];

/** Owner-only: everything every client has done, newest first. */
export default function OwnerActivityPage() {
  const { serverNow } = useAuth();
  const [params, setParams] = useSearchParams();
  const tenant = params.get('client') || '';
  const entityType = params.get('type') || '';
  const page = Number(params.get('page')) || 1;

  const [clients, setClients] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tenants').then(({ data: d }) => setClients(d.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/owner/activity', {
        params: { tenant: tenant || undefined, entityType: entityType || undefined, page },
      });
      setData(d);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tenant, entityType, page]);

  useEffect(() => { load(); }, [load]);

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHead title="Activity" subtitle="Every sign-in and change made by your clients, newest first." />

      {error ? <Alert tone="error" title="Could not load activity">{error}</Alert> : null}

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Client">
              <Select value={tenant} onChange={(event) => update('client', event.target.value)}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Type">
              <Select value={entityType} onChange={(event) => update('type', event.target.value)}>
                {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
          </div>
        </div>
        <div className="card__body card__body--flush">
          {loading && !data ? (
            <Loading label="Loading activity…" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon="🕘" title="No activity" message="Nothing matches these filters yet." />
          ) : (
            <ActivityFeed items={data.items} now={serverNow()} showClient={!tenant} />
          )}
        </div>
        {data?.pages > 1 ? (
          <div className="card__foot">
            <Pagination pagination={data} onChange={(p) => update('page', String(p))} />
          </div>
        ) : null}
      </div>
    </>
  );
}
