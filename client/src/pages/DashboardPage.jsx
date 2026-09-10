import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';
import { Alert, Badge, EmptyState, Loading, Stat } from '../components/ui.jsx';
import { STATUS_TONE, PRIORITY_TONE, formatNumber, relativeTime, formatDateTime } from '../utils/format.js';

export default function DashboardPage() {
  const { user, canManageTickets, canManageInvoices, canViewNetwork, syncClock, serverNow } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const response = await api.get('/dashboard');
        setData(response.data);
        syncClock(response.data.serverTime);
        setError('');
      } catch (err) {
        setError(errorMessage(err));
        if (!quiet) toast.error('Could not load the dashboard', errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [syncClock, toast],
  );

  useEffect(() => {
    load();
    // Keep the operational picture fresh without a manual refresh.
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <Loading label="Loading dashboard…" />;
  if (error && !data) return <Alert tone="error" title="Dashboard unavailable">{error}</Alert>;

  const s = data.stats;
  const maxIssue = Math.max(1, ...data.charts.byIssueType.map((r) => r.count));

  return (
    <>
      <PageHead
        title={`Good ${greeting(serverNow())}, ${user.name.split(' ')[0]}`}
        subtitle="Live operational picture of tickets, customers and billing."
        actions={
          <button className="btn btn--secondary" onClick={() => load()}>
            ⟳ Refresh
          </button>
        }
      />

      <div className="stack">
        <div className="grid grid--stats">
          <Stat label="Total Customers" value={formatNumber(s.totalCustomers)} hint="Active master records" onClick={() => navigate('/customers')} />
          <Stat label="Open Tickets" value={formatNumber(s.openTickets)} tone="warn" hint="New · In Progress · On Hold" onClick={() => navigate('/tickets?open=true')} />
          <Stat label="Urgent Tickets" value={formatNumber(s.urgentTickets)} tone="danger" hint="Priority: Urgent" onClick={() => navigate('/tickets?priority=Urgent&open=true')} />
          <Stat label="Overdue (past ETTR)" value={formatNumber(s.overdueTickets)} tone="danger" hint="Breached the committed ETTR" onClick={() => navigate('/tickets?overdue=true')} />
          <Stat label="In Progress" value={formatNumber(s.inProgressTickets)} tone="warn" hint="Field work underway" onClick={() => navigate('/tickets?status=In Progress')} />
          <Stat label="Resolved Today" value={formatNumber(s.resolvedToday)} tone="ok" hint={`${s.createdToday} created today`} />
          <Stat label="Pending Invoices" value={formatNumber(s.pendingInvoices)} tone="purple" hint="Draft or Unpaid" onClick={() => navigate('/invoices?status=Draft,Unpaid')} />
          <Stat label="Field Members" value={formatNumber(s.totalFieldMembers)} hint="Active engineers" onClick={() => navigate('/field-teams')} />
        </div>

        <div className="card">
          <div className="card__head">
            <h2>Quick actions</h2>
          </div>
          <div className="card__body">
            <div className="quick-actions">
              {canManageTickets ? (
                <Link className="quick-action" to="/tickets/new">
                  <span className="quick-action__icon">🎫</span> Create Ticket
                </Link>
              ) : null}
              {canManageTickets ? (
                <Link className="quick-action" to="/customers?new=1">
                  <span className="quick-action__icon">👤</span> New Customer
                </Link>
              ) : null}
              <Link className="quick-action" to="/search">
                <span className="quick-action__icon">🔍</span> Search
              </Link>
              {canManageInvoices ? (
                <Link className="quick-action" to="/invoices/new">
                  <span className="quick-action__icon">🧾</span> Create Invoice
                </Link>
              ) : null}
              {canViewNetwork ? (
                <Link className="quick-action" to="/customers/import">
                  <span className="quick-action__icon">⭳</span> Import Excel
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid--detail">
          <div className="card">
            <div className="card__head">
              <h2>Recent tickets</h2>
              <div className="card__head-actions">
                <Link className="btn btn--secondary btn--sm" to="/tickets">
                  View all
                </Link>
              </div>
            </div>
            <div className="card__body card__body--flush">
              {data.recentTickets.length === 0 ? (
                <EmptyState icon="🎫" title="No tickets yet" message="Create the first ticket to get started." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>TID</th>
                        <th>Customer</th>
                        <th>Issue</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Time Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentTickets.map((ticket) => (
                        <tr
                          key={ticket._id}
                          onClick={() => navigate(`/tickets/${ticket.ticketNumber}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td><span className="tid">{ticket.ticketNumber}</span></td>
                          <td>
                            <div className="strong">{ticket.customerName}</div>
                            <div className="small muted">{ticket.customerReferenceNumber}</div>
                          </td>
                          <td className="nowrap">{ticket.issueType}</td>
                          <td><Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge></td>
                          <td><Badge tone={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></td>
                          <td className="nowrap">
                            <Countdown
                              ettrAt={ticket.ettrAt}
                              frozen={ticket.timeLeft.frozen}
                              frozenAt={ticket.resolvedAt}
                              short
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card__head">
                <h3>Open tickets by issue type</h3>
              </div>
              <div className="card__body">
                {data.charts.byIssueType.length === 0 ? (
                  <div className="muted small">No open tickets.</div>
                ) : (
                  data.charts.byIssueType.map((row) => (
                    <div className="bar-row" key={row.label}>
                      <span className="truncate" title={row.label}>{row.label}</span>
                      <span className="progress">
                        <span className="progress__bar" style={{ width: `${(row.count / maxIssue) * 100}%` }} />
                      </span>
                      <span className="bar-row__value">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card__head">
                <h3>Recent activity</h3>
              </div>
              <div className="card__body">
                {data.recentActivity.length === 0 ? (
                  <div className="muted small">Nothing recorded yet.</div>
                ) : (
                  <div className="timeline">
                    {data.recentActivity.map((entry) => (
                      <div className="timeline__item" key={entry._id}>
                        <span className="timeline__dot" />
                        <div className="timeline__body">
                          <div className="timeline__title">
                            {entry.actorName} {humanAction(entry.action)} {entry.entityType}
                            {entry.entityLabel ? ` ${entry.entityLabel}` : ''}
                          </div>
                          <div className="timeline__meta" title={formatDateTime(entry.createdAt)}>
                            {relativeTime(entry.createdAt, serverNow())}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function greeting(date) {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function humanAction(action) {
  const map = {
    create: 'created',
    update: 'updated',
    assign: 'assigned',
    resolve: 'resolved',
    soft_delete: 'archived',
    status_change: 'changed the status of',
    import_customers: 'imported',
    deactivate: 'deactivated',
    restore: 'restored',
    login: 'signed in —',
    logout: 'signed out —',
    change_password: 'changed the password for',
    delete: 'deleted',
  };
  return map[action] || action.replace(/_/g, ' ');
}
