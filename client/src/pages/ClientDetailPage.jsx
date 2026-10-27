import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Clock, KeyRound, Receipt, Ticket, Timer, TriangleAlert, Users, Wrench } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import Kpi from '../components/Kpi.jsx';
import { Alert, Badge, ConfirmDialog, EmptyState, Loading } from '../components/ui.jsx';
import ClientFormModal from '../components/ClientFormModal.jsx';
import { AccessPanel } from '../components/AccessModal.jsx';
import {
  ActivityFeed, ClientAvatar, HealthBadge, RangeSwitch, RankBars, TrendBars, durationLabel,
} from '../components/OwnerKit.jsx';
import UsersPage from './UsersPage.jsx';
import { MODULES, PLANS, PLAN_LABELS } from '../utils/modules.js';
import { blobError, downloadFromApi } from '../utils/download.js';
import {
  PRIORITY_TONE, STATUS_TONE, formatDate, formatDateTime, formatNumber, relativeTime,
} from '../utils/format.js';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'logins', label: 'Logins' },
  { key: 'access', label: 'Feature access' },
  { key: 'activity', label: 'Activity' },
];
const whole = (v) => Math.round(Number(v || 0)).toLocaleString('en-US');

/**
 * Owner-only: everything about one client in one place. The header says who
 * they are and whether they are OK; the tabs hold how they are doing, their
 * logins, which features they can use, and what they have been doing.
 */
export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview';
  const { serverNow } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loginCount, setLoginCount] = useState(null);
  const [backingUp, setBackingUp] = useState(false);

  /** Read-only copy of just this client's data. */
  const backup = async () => {
    setBackingUp(true);
    try {
      await downloadFromApi(`/owner/clients/${id}/backup`, 'client-backup.json');
      toast.success('Backup downloaded', data?.client?.name);
    } catch (err) {
      toast.error('Backup failed', await blobError(err));
    } finally {
      setBackingUp(false);
    }
  };

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data: d } = await api.get(`/owner/clients/${id}`, { params: { days } });
      setData(d);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, days]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 60000);
    return () => clearInterval(timer);
  }, [load]);

  const setTab = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'overview') next.delete('tab'); else next.set('tab', key);
    setParams(next, { replace: true });
  };

  const toggleActive = async () => {
    setBusy(true);
    try {
      await api.put(`/tenants/${id}`, { isActive: !data.client.isActive });
      toast.success(data.client.isActive ? 'Client suspended' : 'Client re-activated', data.client.name);
      setToggling(false);
      load(true);
    } catch (err) {
      toast.error('Could not change the status', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveAccess = async (lockedModules, plan) => {
    try {
      await api.put(`/tenants/${id}/access`, { lockedModules, plan });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
    toast.success(
      plan !== 'custom'
        ? `${PLAN_LABELS[plan]} plan saved`
        : lockedModules.length ? `${lockedModules.length} feature${lockedModules.length === 1 ? '' : 's'} locked` : 'All features open',
      data.client.name,
    );
    load(true);
  };

  if (loading && !data) return <Loading label="Loading client…" />;
  if (error && !data) {
    return (
      <>
        <button className="btn btn--secondary" onClick={() => navigate('/clients')}>← All clients</button>
        <Alert tone="error" title="Could not load this client">{error}</Alert>
      </>
    );
  }

  const client = data.client;
  const m = client.metrics;
  const now = serverNow();
  const flagged = client.health.reasons.length > 0;
  const locked = client.lockedModules || [];
  const counts = { logins: loginCount ?? data.logins.length, access: locked.length };

  return (
    <>
      <div className="stack">
        <Link to="/clients" className="small muted">← All clients</Link>

        {/* Who they are, and whether they are OK */}
        <div className="o-client-head">
          <ClientAvatar client={client} large />
          <div className="o-client-head__main">
            <h1 className="o-client-head__name">
              {client.name} <HealthBadge health={client.health} />
              <span className="plan-badge" title="Plan">{PLAN_LABELS[client.plan] || 'Custom'} plan</span>
            </h1>
            <div className="o-client-head__meta">
              <span>👤 {client.contactName || 'No contact person'}</span>
              {client.phone ? <span>📞 {client.phone}</span> : null}
              <span>📅 Client since {formatDate(client.createdAt)}</span>
              <span title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : ''}>
                ⏱ Last active {m.lastActiveAt ? relativeTime(m.lastActiveAt, now) : 'never'}
              </span>
            </div>
          </div>
          <div className="o-client-head__actions">
            <button className="btn btn--secondary" onClick={backup} disabled={backingUp} title="Download a full copy of this client's data">
              {backingUp ? <span className="spinner spinner--dark" /> : '⭳'} Backup
            </button>
            <button className="btn btn--secondary" onClick={() => setEditing(true)}>Edit details</button>
            <button
              className={`btn ${client.isActive ? 'btn--secondary text-danger' : ''}`}
              onClick={() => setToggling(true)}
            >
              {client.isActive ? 'Suspend' : 'Re-activate'}
            </button>
          </div>
        </div>

        {flagged ? (
          <Alert tone={client.health.level === 'critical' ? 'error' : client.health.level === 'suspended' ? 'info' : 'warn'}>
            <strong>{client.health.label}</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {client.health.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </Alert>
        ) : null}

        <div className="o-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`o-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {counts[t.key] !== undefined ? (
                <span className="o-tab__count">
                  {t.key === 'access'
                    ? (client.plan && client.plan !== 'custom' ? PLAN_LABELS[client.plan] : counts.access ? `${counts.access} locked` : 'all open')
                    : counts[t.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {tab === 'overview' ? <OverviewTab data={data} days={days} setDays={setDays} now={now} /> : null}

        {tab === 'logins' ? <UsersPage tenantId={id} onCount={setLoginCount} /> : null}

        {tab === 'access' ? (
          <section className="o-section">
            <div className="o-section__head">
              <div>
                <h2 className="o-section__title">Plan &amp; feature access</h2>
                <p className="o-section__sub">
                  Pick the package {client.name} bought, or switch features by hand. Locked features stay in their menu with a 🔒 but cannot be
                  opened — for every login of this client. To lock something for one person only, open the
                  {' '}<button type="button" className="link-btn" onClick={() => setTab('logins')}>Logins</button> tab and use 🔒 Access.
                </p>
              </div>
            </div>
            <AccessPanel modules={MODULES} locked={locked} plan={client.plan || 'custom'} plans={PLANS} onSave={saveAccess} />
          </section>
        ) : null}

        {tab === 'activity' ? (
          <section className="o-section">
            <div className="o-section__head">
              <div>
                <h2 className="o-section__title">Activity</h2>
                <p className="o-section__sub">The latest sign-ins and changes at {client.name} · {formatNumber(m.actions)} actions in {data.days} days.</p>
              </div>
              <div className="o-section__actions">
                <Link className="btn btn--secondary btn--sm" to={`/activity?client=${client._id}`}>See full history</Link>
              </div>
            </div>
            <div className="card">
              <div className="card__body card__body--flush">
                <ActivityFeed items={data.activity} now={now} />
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <ClientFormModal
        open={editing}
        client={client}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(true); }}
      />
      <ConfirmDialog
        open={toggling}
        title={client.isActive ? `Suspend ${client.name}?` : `Re-activate ${client.name}?`}
        message={client.isActive
          ? 'All of its logins are blocked immediately. No data is deleted, and you can re-activate it at any time.'
          : 'Its logins will be able to sign in again.'}
        confirmLabel={client.isActive ? 'Suspend' : 'Re-activate'}
        tone={client.isActive ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={toggleActive}
        onCancel={() => setToggling(false)}
      />
    </>
  );
}

/** How the client is doing: the numbers first, then the detail behind them. */
function OverviewTab({ data, days, setDays, now }) {
  const m = data.client.metrics;
  const range = `${data.days} days`;
  return (
    <>
      <section className="o-section">
        <div className="o-section__head">
          <div>
            <h2 className="o-section__title">How they are doing</h2>
            <p className="o-section__sub">Tickets, customers and billing at this client in the last {range}.</p>
          </div>
          <div className="o-section__actions"><RangeSwitch value={days} onChange={setDays} /></div>
        </div>
        <div className="kpi-row">
          <Kpi
            icon={TriangleAlert}
            tone={m.tickets.overdue ? 'danger' : 'brand'}
            label="Open tickets"
            value={formatNumber(m.tickets.open)}
            hint={m.tickets.overdue ? `${m.tickets.overdue} past ETTR · ${m.tickets.urgent} urgent` : `${m.tickets.urgent} urgent · none overdue`}
          />
          <Kpi icon={Ticket} tone="info" label="Tickets created" value={formatNumber(m.tickets.created)} hint={`${formatNumber(m.tickets.resolved)} resolved`} />
          <Kpi
            icon={Timer}
            tone={m.tickets.onTimeRate === null ? 'muted' : m.tickets.onTimeRate >= 80 ? 'ok' : 'danger'}
            label="Fixed on time"
            value={m.tickets.onTimeRate === null ? '—' : `${m.tickets.onTimeRate}%`}
            hint={`Average fix time ${durationLabel(m.tickets.avgResolveMinutes)}`}
          />
          <Kpi icon={Receipt} tone="ok" label="Invoiced" prefix="PKR" value={whole(m.invoices.billed)} hint={`PKR ${whole(m.invoices.outstanding)} unpaid · ${m.invoices.count} invoices`} />
        </div>
        <div className="kpi-row">
          <Kpi icon={Users} tone="muted" label="Customers" value={formatNumber(m.customers.total)} hint={`${formatNumber(m.customers.active)} active · ${formatNumber(m.customers.added)} new`} />
          <Kpi icon={Wrench} tone="muted" label="Employees" value={formatNumber(m.employees)} hint={`${m.tickets.unassigned} open ticket(s) unassigned`} />
          <Kpi icon={KeyRound} tone="muted" label="Logins" value={`${m.logins.active} / ${m.logins.total}`} hint="Active / total" />
          <Kpi
            icon={Clock}
            tone="muted"
            label="Last sign-in"
            value={m.logins.lastLoginAt ? relativeTime(m.logins.lastLoginAt, now) : 'Never'}
            hint={m.logins.lastLoginAt ? formatDateTime(m.logins.lastLoginAt) : 'Nobody has signed in yet'}
          />
        </div>
      </section>

      <div className="grid grid--detail">
        <div className="card">
          <div className="card__head">
            <h3>Tickets created per day</h3>
            <span className="card__head-actions small muted">{formatNumber(m.tickets.created)} in {range}</span>
          </div>
          <div className="card__body" style={{ paddingTop: 28 }}>
            <TrendBars series={m.trend} />
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card__head"><h3>All tickets by status</h3></div>
            <div className="card__body"><RankBars rows={data.byStatus} empty="No tickets yet." /></div>
          </div>
          <div className="card">
            <div className="card__head"><h3>Top issue types</h3></div>
            <div className="card__body"><RankBars rows={data.byIssueType} empty={`No tickets in the last ${range}.`} /></div>
          </div>
        </div>
      </div>

      <div className="grid grid--detail">
        <div className="card">
          <div className="card__head"><h3>Latest tickets</h3></div>
          <div className="card__body card__body--flush">
            {data.recentTickets.length === 0 ? (
              <EmptyState icon="🎫" title="No tickets yet" message="This client has not created a ticket." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>TID</th><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {data.recentTickets.map((tk) => (
                      <tr key={tk._id}>
                        <td><span className="tid">{tk.ticketNumber}</span></td>
                        <td>
                          <div className="strong">{tk.customerName}</div>
                          <div className="small muted">{tk.assignedToName ? `→ ${tk.assignedToName}` : 'unassigned'}</div>
                        </td>
                        <td className="small">{tk.issueType}</td>
                        <td><Badge tone={PRIORITY_TONE[tk.priority]}>{tk.priority}</Badge></td>
                        <td>
                          <Badge tone={STATUS_TONE[tk.status]} dot>{tk.status}</Badge>
                          {tk.overdue ? <div><Badge tone="danger">Overdue</Badge></div> : null}
                        </td>
                        <td className="small nowrap" title={formatDateTime(tk.createdAt)}>{relativeTime(tk.createdAt, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h3>Employee workload</h3><span className="small muted">open tickets right now</span></div>
          <div className="card__body card__body--flush">
            {data.workload.length === 0 ? (
              <div className="card__body muted small">No open tickets are assigned to anyone.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Employee</th><th className="text-right">Open</th><th className="text-right">Overdue</th></tr></thead>
                  <tbody>
                    {data.workload.map((w) => (
                      <tr key={w.id}>
                        <td className="strong">{w.name}</td>
                        <td className="text-right">{w.open}</td>
                        <td className={`text-right${w.overdue ? ' text-danger strong' : ''}`}>{w.overdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
