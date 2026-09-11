import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';
import {
  Alert, Badge, EmptyState, Field, Pagination, Select, TableSkeleton, TextInput,
} from '../components/ui.jsx';
import { STATUS_TONE, PRIORITY_TONE, formatDateTime } from '../utils/format.js';

const STATUSES = ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'];
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

export default function TicketsPage() {
  const navigate = useNavigate();
  const { canManageTickets, syncClock } = useAuth();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState({ items: [], pagination: null, loading: true, error: '' });
  const [query, setQuery] = useState(params.get('q') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [priority, setPriority] = useState(params.get('priority') || '');
  const [issueType, setIssueType] = useState(params.get('issueType') || '');
  const [openOnly, setOpenOnly] = useState(params.get('open') === 'true');
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true');
  const [sort, setSort] = useState('-createdAt');
  const [page, setPage] = useState(1);
  const [issueTypes, setIssueTypes] = useState([]);

  useEffect(() => {
    api.get('/meta').then(({ data }) => setIssueTypes(data.issueTypes.map((t) => t.name))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/tickets', {
        params: {
          q: query || undefined,
          status: status || undefined,
          priority: priority || undefined,
          issueType: issueType || undefined,
          open: openOnly ? 'true' : undefined,
          overdue: overdue ? 'true' : undefined,
          sort,
          page,
          limit: 20,
        },
      });
      syncClock(data.serverTime);
      setState({ items: data.items, pagination: data.pagination, loading: false, error: '' });
    } catch (error) {
      setState({ items: [], pagination: null, loading: false, error: errorMessage(error) });
    }
  }, [query, status, priority, issueType, openOnly, overdue, sort, page, syncClock]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 320 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (status) next.set('status', status);
    if (priority) next.set('priority', priority);
    if (issueType) next.set('issueType', issueType);
    if (openOnly) next.set('open', 'true');
    if (overdue) next.set('overdue', 'true');
    setParams(next, { replace: true });
  }, [query, status, priority, issueType, openOnly, overdue, setParams]);

  const reset = () => {
    setQuery(''); setStatus(''); setPriority(''); setIssueType('');
    setOpenOnly(false); setOverdue(false); setPage(1);
  };

  const hasFilters = query || status || priority || issueType || openOnly || overdue;

  return (
    <>
      <PageHead
        title="Tickets"
        subtitle="Every NOC ticket with live ETTR tracking."
        actions={canManageTickets ? <Link className="btn" to="/tickets/new">＋ Create Ticket</Link> : null}
      />

      {state.error ? <Alert tone="error" title="Could not load tickets">{state.error}</Alert> : null}

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput
                placeholder="TID, customer, issue type, remarks…"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              />
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Status">
              <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Priority">
              <Select value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}>
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Issue type">
              <Select value={issueType} onChange={(event) => { setIssueType(event.target.value); setPage(1); }}>
                <option value="">All types</option>
                {issueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Sort by">
              <Select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="-createdAt">Newest first</option>
                <option value="createdAt">Oldest first</option>
                <option value="ettrAt">ETTR soonest</option>
                <option value="-ticketNumber">TID (high → low)</option>
              </Select>
            </Field>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={openOnly} onChange={(event) => { setOpenOnly(event.target.checked); setPage(1); }} />
            Open only
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={overdue} onChange={(event) => { setOverdue(event.target.checked); setPage(1); }} />
            Overdue only
          </label>
          {hasFilters ? <button className="btn btn--ghost btn--sm" onClick={reset}>Clear</button> : null}
        </div>

        <div className="card__body card__body--flush">
          {state.loading ? (
            <TableSkeleton rows={7} cols={8} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="🎫"
              title="No tickets found"
              message={hasFilters ? 'No ticket matches these filters.' : 'Create the first ticket to get started.'}
              action={canManageTickets ? <Link className="btn" to="/tickets/new">＋ Create Ticket</Link> : null}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>TID</th><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th>
                    <th>Created</th><th>Time Left</th><th>Assigned To</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((ticket) => (
                    <tr
                      key={ticket._id}
                      style={{ cursor: 'pointer', background: ticket.isOverdue ? 'rgba(254,226,226,0.4)' : undefined }}
                      onClick={() => navigate(`/tickets/${ticket.ticketNumber}`)}
                    >
                      <td><span className="tid">{ticket.ticketNumber}</span></td>
                      <td>
                        <div className="strong">{ticket.customerName}</div>
                        <div className="small muted">{ticket.customerReferenceNumber}</div>
                      </td>
                      <td className="nowrap">
                        {ticket.issueType}
                        {ticket.remarks ? <div className="small muted truncate" title={ticket.remarks}>{ticket.remarks}</div> : null}
                      </td>
                      <td><Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge></td>
                      <td><Badge tone={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></td>
                      <td className="nowrap small">{formatDateTime(ticket.createdAt)}</td>
                      <td className="nowrap">
                        <Countdown ettrAt={ticket.ettrAt} frozen={ticket.timeLeft.frozen} frozenAt={ticket.resolvedAt} short />
                      </td>
                      <td className="nowrap">{ticket.assignedToName || <span className="muted">Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Pagination pagination={state.pagination} onChange={setPage} />
      </div>
    </>
  );
}
