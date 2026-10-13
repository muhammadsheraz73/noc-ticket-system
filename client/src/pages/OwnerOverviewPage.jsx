import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, EmptyState, Loading, Stat } from '../components/ui.jsx';
import {
  ActivityFeed, ClientAvatar, HealthBadge, Meter, RangeSwitch, Sparkline, TrendBars,
} from '../components/OwnerKit.jsx';
import { formatDateTime, formatMoney, formatNumber, relativeTime } from '../utils/format.js';

const LEVEL_ORDER = { critical: 0, attention: 1, healthy: 2, suspended: 3 };

/** Owner home: how every client is doing, and who needs a call today. */
export default function OwnerOverviewPage() {
  const { serverNow, syncClock } = useAuth();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data: d } = await api.get('/owner/overview', { params: { days } });
      setData(d);
      syncClock?.(d.serverTime);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [days, syncClock]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) return <Loading label="Loading your clients…" />;
  if (error && !data) return <Alert tone="error" title="Overview unavailable">{error}</Alert>;

  const t = data.totals;
  const now = serverNow();
  const clients = [...data.clients].sort(
    (a, b) => LEVEL_ORDER[a.health.level] - LEVEL_ORDER[b.health.level] || a.name.localeCompare(b.name),
  );
  const flagged = clients.filter((c) => ['critical', 'attention'].includes(c.health.level));

  return (
    <>
      <PageHead
        title="Panel overview"
        subtitle={`Live health of every client on your panel · last ${data.days} days`}
        actions={
          <>
            <RangeSwitch value={days} onChange={setDays} />
            <button className="btn btn--secondary" onClick={() => load()} disabled={loading}>
              {loading ? <span className="spinner spinner--dark" /> : '↻'} Refresh
            </button>
            <Link className="btn" to="/clients?new=1">＋ New client</Link>
          </>
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="stack">
        <div className="grid grid--stats">
          <Stat
            label="Clients"
            value={`${formatNumber(t.activeClients)} / ${formatNumber(t.clients)}`}
            hint={t.clients - t.activeClients ? `${t.clients - t.activeClients} suspended` : 'all active'}
            onClick={() => navigate('/clients')}
          />
          <Stat
            label="Need attention"
            value={formatNumber(t.needsAttention)}
            tone={t.critical ? 'danger' : t.needsAttention ? 'warn' : 'ok'}
            hint={t.critical ? `${t.critical} critical` : t.needsAttention ? 'see the list below' : 'everyone is healthy'}
          />
          <Stat
            label="Open tickets"
            value={formatNumber(t.openTickets)}
            tone={t.overdueTickets ? 'danger' : 'warn'}
            hint={t.overdueTickets ? `${t.overdueTickets} past ETTR` : 'none past ETTR'}
          />
          <Stat
            label={`Tickets · ${data.days}d`}
            value={formatNumber(t.ticketsCreated)}
            hint={`${formatNumber(t.ticketsResolved)} resolved`}
          />
          <Stat
            label="Resolved within ETTR"
            value={t.onTimeRate === null ? '—' : `${t.onTimeRate}%`}
            tone={t.onTimeRate === null ? '' : t.onTimeRate >= 80 ? 'ok' : t.onTimeRate >= 60 ? 'warn' : 'danger'}
            hint={`of tickets resolved in ${data.days}d`}
          />
          <Stat
            label="Customers"
            value={formatNumber(t.customers)}
            hint={`${formatNumber(t.customersAdded)} added in ${data.days}d`}
          />
          <Stat
            label="Active logins"
            value={`${formatNumber(t.loginsActiveInRange)} / ${formatNumber(t.logins)}`}
            tone="purple"
            hint={`signed in during ${data.days}d`}
            onClick={() => navigate('/users')}
          />
          <Stat
            label={`Billed · ${data.days}d`}
            value={formatMoney(t.billed).replace('.00', '')}
            hint={`${formatMoney(t.outstanding).replace('.00', '')} unpaid`}
          />
        </div>

        <div className="grid grid--detail">
          <div className="card">
            <div className="card__head">
              <h3>Tickets created per day — all clients</h3>
              <span className="card__head-actions small muted">{formatNumber(t.ticketsCreated)} in {data.days} days</span>
            </div>
            <div className="card__body" style={{ paddingTop: 28 }}>
              <TrendBars series={data.trend} />
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h3>Needs attention</h3>
              <span className="card__head-actions small muted">{flagged.length} client{flagged.length === 1 ? '' : 's'}</span>
            </div>
            <div className="card__body card__body--flush">
              {flagged.length === 0 ? (
                <EmptyState icon="✅" title="All clients healthy" message="No overdue tickets, idle clients or missing logins." />
              ) : (
                <div className="attention-list">
                  {flagged.map((c) => (
                    <Link key={c._id} className="attention-item" to={`/clients/${c._id}`}>
                      <ClientAvatar client={c} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="strong">{c.name}</span>
                          <HealthBadge health={c.health} />
                        </div>
                        <ul>{c.health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                      </div>
                      <span className="muted">›</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h3>Client health</h3>
            <span className="small muted">Click a client to open its full monitoring page</span>
            <div className="card__head-actions">
              <Link className="btn btn--secondary btn--sm" to="/clients">Manage clients</Link>
            </div>
          </div>
          <div className="card__body card__body--flush">
            {clients.length === 0 ? (
              <EmptyState
                icon="🏢"
                title="No clients yet"
                message="Create your first client, then give it a login."
                action={<Link className="btn" to="/clients?new=1">＋ New client</Link>}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Health</th>
                      <th className="text-right">Open</th>
                      <th className="text-right">Overdue</th>
                      <th>Tickets · {data.days}d</th>
                      <th>Within ETTR</th>
                      <th className="text-right">Customers</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => {
                      const m = c.metrics;
                      return (
                        <tr key={c._id} className="clickable-row" onClick={() => navigate(`/clients/${c._id}`)}>
                          <td>
                            <div className="client-cell">
                              <ClientAvatar client={c} />
                              <div style={{ minWidth: 0 }}>
                                <div className="strong">{c.name}</div>
                                <div className="small muted">
                                  {m.logins.active} login{m.logins.active === 1 ? '' : 's'} · {m.employees} employee{m.employees === 1 ? '' : 's'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td><HealthBadge health={c.health} /></td>
                          <td className="text-right mono">{formatNumber(m.tickets.open)}</td>
                          <td className={`text-right mono${m.tickets.overdue ? ' text-danger strong' : ''}`}>{formatNumber(m.tickets.overdue)}</td>
                          <td>
                            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                              <Sparkline series={m.trend} />
                              <span className="mono small">{formatNumber(m.tickets.created)}</span>
                            </div>
                          </td>
                          <td><Meter value={m.tickets.onTimeRate} label={`${m.tickets.resolved} resolved`} /></td>
                          <td className="text-right mono">{formatNumber(m.customers.total)}</td>
                          <td className="small nowrap" title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : ''}>
                            {m.lastActiveAt ? relativeTime(m.lastActiveAt, now) : <span className="muted">never</span>}
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

        <div className="card">
          <div className="card__head">
            <h3>Latest activity across clients</h3>
            <div className="card__head-actions">
              <Link className="btn btn--secondary btn--sm" to="/activity">View all</Link>
            </div>
          </div>
          <div className="card__body card__body--flush">
            <ActivityFeed items={data.activity} now={now} showClient />
          </div>
        </div>
      </div>
    </>
  );
}
