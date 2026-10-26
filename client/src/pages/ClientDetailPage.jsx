import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, ConfirmDialog, EmptyState, Loading, Stat } from '../components/ui.jsx';
import ClientFormModal from '../components/ClientFormModal.jsx';
import AccessModal from '../components/AccessModal.jsx';
import { MODULES } from '../utils/modules.js';
import {
  ActivityFeed, ClientAvatar, HealthBadge, RangeSwitch, RankBars, TrendBars, durationLabel,
} from '../components/OwnerKit.jsx';
import {
  PRIORITY_TONE, STATUS_TONE, formatDate, formatDateTime, formatMoney, formatNumber, relativeTime,
} from '../utils/format.js';

/** Owner-only: one client in depth — workload, speed, usage and who is doing what. */
export default function ClientDetailPage() {
  const { id } = useParams();
  const { serverNow } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Features locked for the whole client, loaded when the access dialog opens. */
  const [access, setAccess] = useState(null);

  const openAccess = async () => {
    try {
      const { data: d } = await api.get(`/tenants/${id}`);
      setAccess(d.tenant.lockedModules || []);
    } catch (err) {
      toast.error('Could not load feature access', errorMessage(err));
    }
  };

  const saveAccess = async (lockedModules) => {
    try {
      await api.put(`/tenants/${id}/access`, { lockedModules });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
    toast.success(
      lockedModules.length ? `${lockedModules.length} feature${lockedModules.length === 1 ? '' : 's'} locked` : 'All features open',
      data.client.name,
    );
    setAccess(null);
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

  if (loading && !data) return <Loading label="Loading client…" />;
  if (error && !data) {
    return (
      <>
        <PageHead title="Client" back="/clients" />
        <Alert tone="error" title="Could not load this client">{error}</Alert>
      </>
    );
  }

  const client = data.client;
  const m = client.metrics;
  const now = serverNow();
  const range = `${data.days}d`;
  const flagged = client.health.reasons.length > 0;

  return (
    <>
      <PageHead
        back="/clients"
        title={client.name}
        subtitle={`Client monitoring · last ${data.days} days`}
        actions={
          <>
            <RangeSwitch value={days} onChange={setDays} />
            <Link className="btn btn--secondary" to={`/users?client=${client._id}`}>Logins</Link>
            <button className="btn btn--secondary" onClick={openAccess}>🔒 Feature access</button>
            <button className="btn btn--secondary" onClick={() => setEditing(true)}>Edit</button>
            <button
              className={`btn ${client.isActive ? 'btn--secondary text-danger' : ''}`}
              onClick={() => setToggling(true)}
            >
              {client.isActive ? 'Suspend' : 'Re-activate'}
            </button>
          </>
        }
      />

      <div className="stack">
        <div className="card">
          <div className="card__body client-hero">
            <ClientAvatar client={client} large />
            <div style={{ flex: 1, minWidth: 0 }}>
              <HealthBadge health={client.health} />
              <div className="client-hero__meta">
                <span>👤 {client.contactName || 'No contact person'}</span>
                {client.phone ? <span>📞 {client.phone}</span> : null}
                <span>📅 Client since {formatDate(client.createdAt)}</span>
                <span title={m.lastActiveAt ? formatDateTime(m.lastActiveAt) : ''}>
                  ⏱ Last active {m.lastActiveAt ? relativeTime(m.lastActiveAt, now) : 'never'}
                </span>
              </div>
              {client.notes ? <div className="small muted" style={{ marginTop: 6 }}>{client.notes}</div> : null}
            </div>
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

        <div className="grid grid--stats">
          <Stat
            label="Open tickets"
            value={formatNumber(m.tickets.open)}
            tone={m.tickets.overdue ? 'danger' : 'warn'}
            hint={m.tickets.overdue ? `${m.tickets.overdue} past ETTR · ${m.tickets.urgent} urgent` : `${m.tickets.urgent} urgent · none overdue`}
          />
          <Stat label={`Tickets · ${range}`} value={formatNumber(m.tickets.created)} hint={`${formatNumber(m.tickets.resolved)} resolved`} />
          <Stat
            label="Resolved within ETTR"
            value={m.tickets.onTimeRate === null ? '—' : `${m.tickets.onTimeRate}%`}
            tone={m.tickets.onTimeRate === null ? '' : m.tickets.onTimeRate >= 80 ? 'ok' : m.tickets.onTimeRate >= 60 ? 'warn' : 'danger'}
            hint={`of ${m.tickets.resolved} resolved in ${range}`}
          />
          <Stat label="Avg. time to resolve" value={durationLabel(m.tickets.avgResolveMinutes)} hint={`tickets resolved in ${range}`} />
          <Stat
            label="Customers"
            value={formatNumber(m.customers.total)}
            hint={`${formatNumber(m.customers.active)} active · ${formatNumber(m.customers.added)} new`}
          />
          <Stat label="Employees" value={formatNumber(m.employees)} hint={`${m.tickets.unassigned} open ticket(s) unassigned`} />
          <Stat
            label="Logins"
            value={`${m.logins.active} / ${m.logins.total}`}
            tone="purple"
            hint={m.logins.lastLoginAt ? `last sign-in ${relativeTime(m.logins.lastLoginAt, now)}` : 'never signed in'}
          />
          <Stat
            label={`Billed · ${range}`}
            value={formatMoney(m.invoices.billed).replace('.00', '')}
            hint={`${formatMoney(m.invoices.outstanding).replace('.00', '')} unpaid · ${m.invoices.count} invoices`}
          />
        </div>

        <div className="grid grid--detail">
          <div className="card">
            <div className="card__head">
              <h3>Tickets created per day</h3>
              <span className="card__head-actions small muted">{formatNumber(m.tickets.created)} in {data.days} days</span>
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
              <div className="card__head"><h3>Top issue types · {range}</h3></div>
              <div className="card__body"><RankBars rows={data.byIssueType} empty={`No tickets in the last ${data.days} days.`} /></div>
            </div>
          </div>
        </div>

        <div className="grid grid--2">
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
                          <td className="text-right mono">{w.open}</td>
                          <td className={`text-right mono${w.overdue ? ' text-danger strong' : ''}`}>{w.overdue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h3>Logins</h3>
              <div className="card__head-actions">
                <Link className="btn btn--ghost btn--sm" to={`/users?client=${client._id}`}>Manage</Link>
              </div>
            </div>
            <div className="card__body card__body--flush">
              {data.logins.length === 0 ? (
                <EmptyState
                  icon="🔑"
                  title="No login yet"
                  message="This client cannot sign in until you create a login for it."
                  action={<Link className="btn" to={`/users?client=${client._id}`}>＋ Add login</Link>}
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>User</th><th>Last sign-in</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.logins.map((u) => (
                        <tr key={u._id}>
                          <td>
                            <div className="strong">{u.name}</div>
                            <div className="small muted mono">{u.username}</div>
                          </td>
                          <td className="small nowrap" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : ''}>
                            {u.lastLoginAt ? relativeTime(u.lastLoginAt, now) : <span className="muted">never</span>}
                          </td>
                          <td><Badge tone={u.isActive ? 'ok' : 'neutral'}>{u.isActive ? 'Active' : 'Disabled'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
            <div className="card__head"><h3>Activity</h3><span className="small muted">{formatNumber(m.actions)} actions in {range}</span></div>
            <div className="card__body card__body--flush" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <ActivityFeed items={data.activity} now={now} />
            </div>
          </div>
        </div>
      </div>

      <ClientFormModal
        open={editing}
        client={client}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(true); }}
      />
      <AccessModal
        open={access !== null}
        title={`Feature access — ${client.name}`}
        intro="Locked features stay in the menu with a padlock but cannot be opened, for every login of this client (admin and billing team). To lock something for one login only, use Logins → Access."
        modules={MODULES}
        locked={access || []}
        onClose={() => setAccess(null)}
        onSave={saveAccess}
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
