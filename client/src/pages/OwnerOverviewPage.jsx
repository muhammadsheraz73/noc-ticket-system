import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, KeyRound, Receipt, Ticket, Timer, TriangleAlert, UserPlus, Users } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Kpi from '../components/Kpi.jsx';
import { Alert, EmptyState, Loading } from '../components/ui.jsx';
import { ActivityFeed, ClientAvatar, HealthBadge, RangeSwitch, TrendBars } from '../components/OwnerKit.jsx';
import { formatDateTime, formatNumber, relativeTime } from '../utils/format.js';

const LEVEL_ORDER = { critical: 0, attention: 1, healthy: 2, suspended: 3 };
const whole = (v) => Math.round(Number(v || 0)).toLocaleString('en-US');

/**
 * Owner home, top to bottom: the headline numbers, who needs a call today,
 * every client as a card, then how much the panel is being used.
 */
export default function OwnerOverviewPage() {
  const { user, serverNow, syncClock } = useAuth();
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
  const suspended = t.clients - t.activeClients;
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHead
        title={`${greeting}, ${user.name.split(' ')[0]}`}
        subtitle={`You have ${t.clients} client${t.clients === 1 ? '' : 's'} on your panel. Here is how they are doing.`}
        actions={<Link className="btn" to="/clients?new=1">＋ New client</Link>}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="stack">
        {/* 1 — headline numbers */}
        <div className="kpi-row">
          <Kpi
            icon={Building2}
            tone="brand"
            label="Clients"
            value={formatNumber(t.clients)}
            hint={`${t.activeClients} active${suspended ? ` · ${suspended} suspended` : ''}`}
            onClick={() => navigate('/clients')}
          />
          <Kpi
            icon={TriangleAlert}
            tone={t.needsAttention ? 'danger' : 'ok'}
            label="Need attention"
            value={formatNumber(t.needsAttention)}
            hint={t.needsAttention ? 'See the list below' : 'Everyone is healthy'}
            onClick={() => navigate('/clients?show=attention')}
          />
          <Kpi
            icon={KeyRound}
            tone="info"
            label="Active logins"
            value={formatNumber(t.logins)}
            hint={`${formatNumber(t.loginsActiveInRange)} signed in during the last ${data.days} days`}
          />
          <Kpi
            icon={Users}
            tone="muted"
            label="Customers"
            value={formatNumber(t.customers)}
            hint="Across all your clients"
          />
        </div>

        {/* 2 — who needs a call today */}
        <section className="o-section" aria-labelledby="attention-title">
          <div className="o-section__head">
            <div>
              <h2 className="o-section__title" id="attention-title">Needs your attention</h2>
              <p className="o-section__sub">Clients with overdue tickets, no activity or no working login.</p>
            </div>
          </div>
          {flagged.length === 0 ? (
            <div className="o-allgood"><span aria-hidden="true">✓</span> All clients are healthy — nothing needs you right now.</div>
          ) : (
            <div className="o-alerts">
              {flagged.map((c) => (
                <Link key={c._id} className={`o-alert${c.health.level === 'critical' ? ' o-alert--critical' : ''}`} to={`/clients/${c._id}`}>
                  <ClientAvatar client={c} />
                  <div className="o-alert__body">
                    <div className="row" style={{ gap: 8 }}>
                      <span className="o-alert__name">{c.name}</span>
                      <HealthBadge health={c.health} />
                    </div>
                    <ul className="o-alert__reasons">{c.health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  </div>
                  <span className="o-alert__go">Open client →</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 3 — every client */}
        <section className="o-section" aria-labelledby="clients-title">
          <div className="o-section__head">
            <div>
              <h2 className="o-section__title" id="clients-title">Your clients</h2>
              <p className="o-section__sub">Open a client to manage its logins, feature access and details.</p>
            </div>
            <div className="o-section__actions">
              <Link className="btn btn--secondary btn--sm" to="/clients">View as list</Link>
            </div>
          </div>
          {clients.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="🏢"
                title="No clients yet"
                message="Create your first client, then give it a login."
                action={<Link className="btn" to="/clients?new=1">＋ New client</Link>}
              />
            </div>
          ) : (
            <div className="o-cards">
              {clients.map((c) => <ClientCard key={c._id} client={c} now={now} />)}
              <button type="button" className="o-card o-card--new" onClick={() => navigate('/clients?new=1')}>
                <b>＋</b>
                <span className="strong">Add a client</span>
                <span className="small">Sell the panel to a new company</span>
              </button>
            </div>
          )}
        </section>

        {/* 4 — how much the panel is used */}
        <section className="o-section" aria-labelledby="usage-title">
          <div className="o-section__head">
            <div>
              <h2 className="o-section__title" id="usage-title">Usage across all clients</h2>
              <p className="o-section__sub">What your clients did on the panel in the last {data.days} days.</p>
            </div>
            <div className="o-section__actions"><RangeSwitch value={days} onChange={setDays} /></div>
          </div>
          <div className="kpi-row">
            <Kpi icon={Ticket} tone="brand" label="Tickets created" value={formatNumber(t.ticketsCreated)} hint={`${formatNumber(t.ticketsResolved)} resolved · ${formatNumber(t.openTickets)} open now`} />
            <Kpi
              icon={Timer}
              tone={t.onTimeRate === null ? 'muted' : t.onTimeRate >= 80 ? 'ok' : 'danger'}
              label="Fixed on time"
              value={t.onTimeRate === null ? '—' : `${t.onTimeRate}%`}
              hint="Tickets resolved within their ETTR"
            />
            <Kpi icon={UserPlus} tone="info" label="New customers" value={formatNumber(t.customersAdded)} hint={`${formatNumber(t.customers)} customers in total`} />
            <Kpi icon={Receipt} tone="ok" label="Invoiced" prefix="PKR" value={whole(t.billed)} hint={`PKR ${whole(t.outstanding)} still unpaid`} />
          </div>
          <div className="card">
            <div className="card__head">
              <h3>Tickets created per day</h3>
              <span className="card__head-actions small muted">{formatNumber(t.ticketsCreated)} in {data.days} days, all clients</span>
            </div>
            <div className="card__body" style={{ paddingTop: 28 }}>
              <TrendBars series={data.trend} />
            </div>
          </div>
        </section>

        {/* 5 — latest happenings */}
        <section className="o-section" aria-labelledby="activity-title">
          <div className="o-section__head">
            <div>
              <h2 className="o-section__title" id="activity-title">Recent activity</h2>
              <p className="o-section__sub">The latest sign-ins and changes made by your clients.</p>
            </div>
            <div className="o-section__actions">
              <Link className="btn btn--secondary btn--sm" to="/activity">View all activity</Link>
            </div>
          </div>
          <div className="card">
            <div className="card__body card__body--flush">
              <ActivityFeed items={data.activity} now={now} showClient />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

/** One client at a glance; the whole card opens the client's page. */
function ClientCard({ client, now }) {
  const m = client.metrics;
  const suspended = client.health.level === 'suspended';
  return (
    <Link className={`o-card${suspended ? ' is-suspended' : ''}`} to={`/clients/${client._id}`}>
      <div className="o-card__top">
        <ClientAvatar client={client} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="o-card__name">{client.name}</div>
          <div className="o-card__contact">{[client.contactName, client.phone].filter(Boolean).join(' · ') || 'No contact saved'}</div>
        </div>
      </div>
      <HealthBadge health={client.health} />
      <div className="o-card__stats">
        <div className="o-card__stat"><b>{m.logins.active}</b><span>Logins</span></div>
        <div className="o-card__stat"><b>{formatNumber(m.customers.total)}</b><span>Customers</span></div>
        <div className="o-card__stat"><b>{formatNumber(m.tickets.open)}</b><span>Open</span></div>
        <div className={`o-card__stat${m.tickets.overdue ? ' o-card__stat--danger' : ''}`}><b>{formatNumber(m.tickets.overdue)}</b><span>Overdue</span></div>
      </div>
      <div className="o-card__foot">
        <span title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : ''}>
          {m.lastActiveAt ? `Active ${relativeTime(m.lastActiveAt, now)}` : 'Never used yet'}
        </span>
        <span className="o-card__open">Open →</span>
      </div>
    </Link>
  );
}
