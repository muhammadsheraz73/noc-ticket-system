import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, Ticket, UserPlus, Receipt, Upload, ChevronRight } from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';
import { Alert, EmptyState } from '../components/ui.jsx';
import { Button, buttonVariants } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';
import { Progress } from '../components/ui/progress.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { STATUS_TONE, PRIORITY_TONE, formatNumber, relativeTime, formatDateTime, initials } from '../utils/format.js';
import { cn } from '../lib/utils.js';

const TONE_VAR = { danger: '--danger', warn: '--warn', ok: '--ok', purple: '--purple', '': '--brand-accent' };

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

  if (loading) return <DashboardSkeleton />;
  if (error && !data) return <Alert tone="error" title="Dashboard unavailable">{error}</Alert>;

  const s = data.stats;
  const maxIssue = Math.max(1, ...data.charts.byIssueType.map((r) => r.count));

  return (
    <>
      <PageHead
        title={`Good ${greeting(serverNow())}, ${user.name.split(' ')[0]}`}
        subtitle="Live operational picture of tickets, customers and billing."
        actions={
          <Button variant="outline" onClick={() => load()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />

      <div className="stack">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Total Customers" value={formatNumber(s.totalCustomers)} hint="Active master records" onClick={() => navigate('/customers')} />
          <StatTile label="Total Tickets" value={formatNumber(s.totalTickets)} hint="All tickets, every status" onClick={() => navigate('/tickets')} />
          <StatTile label="Open Tickets" value={formatNumber(s.openTickets)} tone="warn" hint="New · In Progress · On Hold" onClick={() => navigate('/tickets?open=true')} />
          <StatTile label="Urgent Tickets" value={formatNumber(s.urgentTickets)} tone="danger" hint="Priority: Urgent" onClick={() => navigate('/tickets?priority=Urgent&open=true')} />
          <StatTile label="Overdue (past ETTR)" value={formatNumber(s.overdueTickets)} tone="danger" hint="Breached the committed ETTR" onClick={() => navigate('/tickets?overdue=true')} />
          <StatTile label="In Progress" value={formatNumber(s.inProgressTickets)} tone="warn" hint="Field work underway" onClick={() => navigate('/tickets?status=In Progress')} />
          <StatTile label="Resolved Today" value={formatNumber(s.resolvedToday)} tone="ok" hint={`${s.createdToday} created today`} />
          <StatTile label="Pending Invoices" value={formatNumber(s.pendingInvoices)} tone="purple" hint="Draft or Unpaid" onClick={() => navigate('/invoices?status=Draft,Unpaid')} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {canManageTickets ? (
                <QuickAction to="/tickets/new" icon={Ticket} label="Create Ticket" />
              ) : null}
              {canManageTickets ? (
                <QuickAction to="/customers?new=1" icon={UserPlus} label="New Customer" />
              ) : null}
              {canManageInvoices ? (
                <QuickAction to="/invoices/new" icon={Receipt} label="Create Invoice" />
              ) : null}
              {canViewNetwork ? (
                <QuickAction to="/customers/import" icon={Upload} label="Import Excel" />
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid--detail">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent tickets</CardTitle>
              <CardAction>
                <Link
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 font-semibold')}
                  to="/tickets"
                >
                  View all <ChevronRight className="size-3.5" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0 -mt-3">
              {data.recentTickets.length === 0 ? (
                <EmptyState icon="🎫" title="No tickets yet" message="Create the first ticket to get started." />
              ) : (
                <Table className="table-fixed min-w-[520px] [&_th]:text-[10.5px] [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:font-semibold">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[8%]">TID</TableHead>
                      <TableHead className="w-[28%]">Customer</TableHead>
                      <TableHead className="w-[16%]">Issue</TableHead>
                      <TableHead className="w-[13%]">Priority</TableHead>
                      <TableHead className="w-[18%]">Status</TableHead>
                      <TableHead className="w-[17%] text-right">Time Left</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_td]:py-3 [&_tr]:border-b-0 [&_tr:nth-child(even)]:bg-muted/40">
                    {data.recentTickets.map((ticket) => (
                      <TableRow
                        key={ticket._id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/tickets/${ticket.ticketNumber}`)}
                      >
                        <TableCell><span className="tid">{ticket.ticketNumber}</span></TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                              {initials(ticket.customerName)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="strong overflow-hidden text-ellipsis whitespace-nowrap" title={ticket.customerName}>{ticket.customerName}</div>
                              <div className="small muted overflow-hidden text-ellipsis whitespace-nowrap" title={ticket.customerReferenceNumber}>{ticket.customerReferenceNumber}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Badge variant="outline" className="max-w-full">
                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={ticket.issueType}>{ticket.issueType}</span>
                          </Badge>
                        </TableCell>
                        <TableCell><Badge variant={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge></TableCell>
                        <TableCell><Badge variant={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold">
                          <Countdown
                            ettrAt={ticket.ettrAt}
                            frozen={ticket.timeLeft.frozen}
                            frozenAt={ticket.resolvedAt}
                            short
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="stack">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Open tickets by issue type</CardTitle>
              </CardHeader>
              <CardContent>
                {data.charts.byIssueType.length === 0 ? (
                  <div className="muted small">No open tickets.</div>
                ) : (
                  <div className="grid gap-3">
                    {data.charts.byIssueType.map((row) => (
                      <div className="grid grid-cols-[120px_1fr_34px] items-center gap-2.5 text-xs" key={row.label}>
                        <span className="truncate" title={row.label}>{row.label}</span>
                        <Progress value={(row.count / maxIssue) * 100} />
                        <span className="text-right font-semibold tabular-nums">{row.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent activity</CardTitle>
                {data.activityScope ? (
                  <CardDescription className="text-xs">{data.activityScope}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                {data.recentActivity.length === 0 ? (
                  <div className="muted small">{emptyActivityMessage(user?.role)}</div>
                ) : (
                  <div className="timeline timeline--bordered max-h-[330px] overflow-y-auto pr-1">
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
                          {entry.note ? <div className="small muted">“{entry.note}”</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function StatTile({ label, value, hint, tone = '', onClick }) {
  const varName = TONE_VAR[tone] ?? TONE_VAR[''];
  return (
    <Card
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'relative overflow-hidden border-l-4 text-left',
        onClick && 'cursor-pointer transition-colors hover:bg-muted/40',
      )}
      style={{ borderLeftColor: `var(${varName})` }}
    >
      <CardContent>
        <div className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums leading-none">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  const className = cn(
    buttonVariants({ variant: 'outline' }),
    'h-auto flex-col gap-2 py-4 text-xs font-semibold',
  );

  return (
    <Link to={to} className={className}>
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="stack">
      <div className="page-head">
        <div className="page-head__text">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-7 w-16" />
              <Skeleton className="mt-2 h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function greeting(date) {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** The feed is scoped server-side, so say why it can legitimately be empty. */
function emptyActivityMessage(role) {
  if (role === 'field_engineer') return 'No activity on the tickets assigned to you yet.';
  if (role === 'accounts') return 'No billing or customer activity yet.';
  return 'Nothing recorded yet.';
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
