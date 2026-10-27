import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, EmptyState, Loading, Pagination, Select } from '../components/ui.jsx';
import { ACTIVITY_TYPES, ActivityFeed } from '../components/OwnerKit.jsx';

/** Owner-only: everything every client has done, grouped by day, newest first. */
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

  const clientName = clients.find((c) => c._id === tenant)?.name;

  return (
    <>
      <PageHead
        title="Activity"
        subtitle={clientName
          ? `Everything ${clientName} has done on the panel, newest first.`
          : 'Every sign-in and change made by your clients, newest first.'}
        actions={(
          <Select value={tenant} onChange={(event) => update('client', event.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        )}
      />

      {error ? <Alert tone="error" title="Could not load activity">{error}</Alert> : null}

      <div className="stack">
        <div className="o-chips" role="group" aria-label="Show">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`o-chip${entityType === t.value ? ' is-active' : ''}`}
              aria-pressed={entityType === t.value}
              onClick={() => update('type', t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="card">
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
      </div>
    </>
  );
}
