import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';
import TicketPreview, { CopyTicketButton } from '../components/TicketPreview.jsx';
import {
  Alert, Badge, ConfirmDialog, DefItem, Field, Loading, Modal, Select, TextInput, Textarea,
} from '../components/ui.jsx';
import {
  STATUS_TONE, PRIORITY_TONE, INVOICE_TONE, formatDateTime, formatDate, formatMoney, ettrLabel, relativeTime,
} from '../utils/format.js';

const STATUSES = ['New', 'In Progress', 'On Hold', 'Resolved', 'Closed'];
const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isAdmin, canManageTickets, canViewInvoices, canManageInvoices, serverNow, syncClock } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [teams, setTeams] = useState([]);
  const [meta, setMeta] = useState(null);
  const [assignTo, setAssignTo] = useState('');
  const [assignHelper, setAssignHelper] = useState('');
  const [assignNote, setAssignNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [resolveStatus, setResolveStatus] = useState('Resolved');
  const [editForm, setEditForm] = useState({
    issueType: '',
    priority: '',
    status: '',
    ettrMinutes: 60,
    remarks: '',
    assignedTo: '',
    assignedHelper: '',
  });

  const load = useCallback(async () => {
    try {
      const { data: response } = await api.get(`/tickets/${id}`);
      setData(response);
      syncClock(response.ticket.serverTime);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, syncClock]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (canManageTickets) api.get('/field-teams?assignable=true').then(({ data: d }) => setTeams(d.items)).catch(() => {});
  }, [canManageTickets]);

  useEffect(() => {
    if (canManageTickets) api.get('/meta').then(({ data: d }) => setMeta(d)).catch(() => {});
  }, [canManageTickets]);

  // While an AI analysis is pending, poll until it settles.
  useEffect(() => {
    if (data?.ticket?.ai?.status !== 'pending') return undefined;
    const id2 = setInterval(load, 4000);
    return () => clearInterval(id2);
  }, [data?.ticket?.ai?.status, load]);

  if (loading) return <Loading label="Loading ticket…" />;
  if (error) return <Alert tone="error" title="Ticket not available">{error}</Alert>;

  const { ticket, customer, invoices } = data;
  const closed = ['Resolved', 'Closed'].includes(ticket.status);
  const canEditStatus = canManageTickets || user.role === ROLES.FIELD_ENGINEER;

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await api.put(`/tickets/${ticket.ticketNumber}`, { status });
      toast.success('Status updated', `TID ${ticket.ticketNumber} → ${status}`);
      await load();
    } catch (err) {
      toast.error('Could not update status', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doEdit = async () => {
    setBusy(true);
    try {
      await api.put(`/tickets/${ticket.ticketNumber}`, {
        issueType: editForm.issueType,
        priority: editForm.priority,
        status: editForm.status,
        ettrMinutes: Number(editForm.ettrMinutes),
        remarks: editForm.remarks,
      });

      const assignmentChanged =
        editForm.assignedTo &&
        (editForm.assignedTo !== (ticket.assignedTo || '') ||
          editForm.assignedHelper !== (ticket.assignedHelper || ''));
      if (assignmentChanged) {
        await api.post(`/tickets/${ticket.ticketNumber}/assign`, {
          assignedTo: editForm.assignedTo,
          assignedHelper: editForm.assignedHelper || undefined,
        });
      }

      toast.success('Ticket updated', `TID ${ticket.ticketNumber}`);
      setEditOpen(false);
      await load();
    } catch (err) {
      toast.error('Could not update the ticket', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doAssign = async () => {
    if (!assignTo) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${ticket.ticketNumber}/assign`, {
        assignedTo: assignTo,
        assignedHelper: assignHelper || undefined,
        note: assignNote,
      });
      toast.success('Ticket assigned');
      setAssignOpen(false);
      setAssignNote('');
      await load();
    } catch (err) {
      toast.error('Could not assign the ticket', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doResolve = async () => {
    if (!resolution.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${ticket.ticketNumber}/resolve`, {
        resolutionRemarks: resolution,
        status: resolveStatus,
      });
      toast.success(`Ticket ${resolveStatus.toLowerCase()}`, `TID ${ticket.ticketNumber}`);
      setResolveOpen(false);
      setResolution('');
      await load();
    } catch (err) {
      toast.error('Could not resolve the ticket', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/tickets/${ticket.ticketNumber}`);
      toast.success(`TID ${ticket.ticketNumber} deleted`);
      navigate('/tickets');
    } catch (err) {
      toast.error('Could not delete the ticket', errorMessage(err));
      setBusy(false);
    }
  };

  const retryAi = async () => {
    setBusy(true);
    try {
      const { data: response } = await api.post(`/tickets/${ticket.ticketNumber}/analyze`);
      if (response.ai.status === 'completed') toast.success('AI analysis complete');
      else toast.warning('AI analysis unavailable', response.ai.error);
      await load();
    } catch (err) {
      toast.error('AI analysis failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        back="/tickets"
        title={`Ticket TID ${ticket.ticketNumber}`}
        subtitle={`${ticket.issueType} · ${ticket.customerName} (${ticket.customerReferenceNumber})`}
        actions={
          <>
            {canManageTickets ? (
              <button
                className="btn btn--secondary"
                onClick={() => {
                  setEditForm({
                    issueType: ticket.issueType,
                    priority: ticket.priority,
                    status: ticket.status,
                    ettrMinutes: ticket.ettrMinutes,
                    remarks: ticket.remarks || '',
                    assignedTo: ticket.assignedTo || '',
                    assignedHelper: ticket.assignedHelper || '',
                  });
                  setEditOpen(true);
                }}
              >
                ✏ Edit
              </button>
            ) : null}
            {canManageTickets && !closed ? (
              <button
                className="btn btn--secondary"
                onClick={() => {
                  setAssignTo(ticket.assignedTo || '');
                  setAssignHelper(ticket.assignedHelper || '');
                  setAssignOpen(true);
                }}
              >
                🔧 Assign
              </button>
            ) : null}
            {canEditStatus && !closed ? (
              <button className="btn" onClick={() => setResolveOpen(true)}>✓ Resolve</button>
            ) : null}
            {canManageInvoices ? (
              <Link className="btn btn--secondary" to={`/invoices/new?ticket=${ticket.ticketNumber}`}>🧾 Create Invoice</Link>
            ) : null}
            {isAdmin ? (
              <button className="btn btn--secondary text-danger" onClick={() => setDeleting(true)}>🗑 Delete</button>
            ) : null}
          </>
        }
      />

      <div className="stack">
        <div className="ticket-hero">
          <div className="ticket-hero__block">
            <div className="ticket-hero__label">Ticket ID</div>
            <div className="ticket-hero__tid">{ticket.ticketNumber}</div>
          </div>
          <div className="ticket-hero__block">
            <div className="ticket-hero__label">Priority</div>
            <div className="ticket-hero__value"><Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge></div>
          </div>
          <div className="ticket-hero__block">
            <div className="ticket-hero__label">Status</div>
            <div className="ticket-hero__value"><Badge tone={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></div>
          </div>
          <div className="ticket-hero__block">
            <div className="ticket-hero__label">ETTR</div>
            <div className="ticket-hero__value">{formatDateTime(ticket.ettrAt)}</div>
            <div className="small" style={{ opacity: 0.85 }}>{ettrLabel(ticket.ettrMinutes)}</div>
          </div>
          <div className="ticket-hero__block" style={{ minWidth: 190 }}>
            <div className="ticket-hero__label">Time Left</div>
            <div className="ticket-hero__value" style={{ color: '#fff' }}>
              <Countdown ettrAt={ticket.ettrAt} frozen={ticket.timeLeft.frozen} frozenAt={ticket.resolvedAt} />
            </div>
          </div>
        </div>

        {ticket.isOverdue ? (
          <Alert tone="error" title="Overdue">
            This ticket has passed its committed ETTR. Escalate or extend the ETTR.
          </Alert>
        ) : null}

        <div className="grid grid--detail">
          <div className="stack">
            <div className="card">
              <div className="card__head">
                <h2>Generated ticket</h2>
                <div className="card__head-actions">
                  <CopyTicketButton
                    text={ticket.generatedText}
                    onCopied={(ok) => (ok ? toast.success('Ticket copied to clipboard') : toast.error('Copy failed'))}
                  />
                </div>
              </div>
              <div className="card__body">
                <TicketPreview
                  text={ticket.generatedText}
                  ettrAt={ticket.ettrAt}
                  frozen={ticket.timeLeft.frozen}
                  frozenAt={ticket.resolvedAt}
                />
                <div className="small muted" style={{ marginTop: 10 }}>
                  Internal network data (address, {customer?.type} type, ports, VLAN) is deliberately excluded from this text.
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card__head"><h2>Ticket details</h2></div>
              <div className="card__body">
                <div className="deflist">
                  <DefItem label="Issue Type" value={ticket.issueType} />
                  <DefItem label="Created" value={formatDateTime(ticket.createdAt)} />
                  <DefItem label="ETTR" value={`${formatDateTime(ticket.ettrAt)} (${ettrLabel(ticket.ettrMinutes)})`} />
                  <DefItem label="Assigned By" value={ticket.assignedByName} />
                  <DefItem label="Assigned To" value={ticket.assignedToName || ''} />
                  {ticket.assignedHelperName ? <DefItem label="Helper" value={ticket.assignedHelperName} /> : null}
                  <DefItem label="Assigned At" value={ticket.assignedAt ? formatDateTime(ticket.assignedAt) : ''} />
                  {ticket.resolvedAt ? <DefItem label="Resolved" value={formatDateTime(ticket.resolvedAt)} /> : null}
                  <DefItem label="Remarks" value={ticket.remarks} />
                  {ticket.resolutionRemarks ? <DefItem label="Resolution" value={ticket.resolutionRemarks} /> : null}
                </div>

                {canEditStatus && !closed ? (
                  <div style={{ marginTop: 16 }}>
                    <div className="deflist__label" style={{ marginBottom: 6 }}>Change status</div>
                    <div className="row">
                      {STATUSES.filter((s) => s !== ticket.status).map((status) => (
                        <button key={status} className="btn btn--secondary btn--sm" disabled={busy} onClick={() => changeStatus(status)}>
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card__head"><h2>Audit trail</h2></div>
              <div className="card__body">
                <div className="timeline">
                  {[...ticket.history].reverse().map((entry, index) => (
                    <div className="timeline__item" key={index}>
                      <span className="timeline__dot" />
                      <div className="timeline__body">
                        <div className="timeline__title">
                          {labelAction(entry)}
                        </div>
                        <div className="timeline__meta">
                          {entry.byName} · {formatDateTime(entry.at)} · {relativeTime(entry.at, serverNow())}
                        </div>
                        {entry.note ? <div className="small muted">“{entry.note}”</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="stack">
            {customer ? (
              <div className="card">
                <div className="card__head">
                  <h3>Customer</h3>
                  <div className="card__head-actions">
                    <Link className="btn btn--secondary btn--sm" to={`/customers/${customer.customerReferenceNumber}`}>
                      Full record →
                    </Link>
                  </div>
                </div>
                <div className="card__body">
                  <div className="deflist">
                    <DefItem label="Customer ID" value={customer.customerReferenceNumber} mono />
                    <DefItem label="Name" value={customer.name} />
                    <DefItem label="Contact" value={customer.contactNumber} mono />
                    <DefItem label="Connected From" value={customer.connectedFrom} />
                    <DefItem label="Type" ><Badge tone="outline">{customer.type}</Badge></DefItem>
                    <DefItem label="Address" value={customer.address} />
                    <DefItem label="Source Port" value={customer.sourcePort} mono />
                    <DefItem label="Destination Port" value={customer.destinationPort} mono />
                    <DefItem label="VLAN" value={customer.vlan} mono />
                  </div>
                  <div className="small muted" style={{ marginTop: 10 }}>Internal view — not part of the generated ticket.</div>
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="card__head">
                <h3>AI assistant</h3>
                <div className="card__head-actions">
                  <Badge tone={aiTone(ticket.ai?.status)}>{ticket.ai?.status || 'pending'}</Badge>
                </div>
              </div>
              <div className="card__body">
                <AiPanel ai={ticket.ai} busy={busy} onRetry={canManageTickets ? retryAi : null} />
              </div>
            </div>

            {canViewInvoices ? (
              <div className="card">
                <div className="card__head">
                  <h3>Linked invoices</h3>
                  {canManageInvoices ? (
                    <div className="card__head-actions">
                      <Link className="btn btn--secondary btn--sm" to={`/invoices/new?ticket=${ticket.ticketNumber}`}>＋ New</Link>
                    </div>
                  ) : null}
                </div>
                <div className="card__body">
                  {invoices?.length ? (
                    invoices.map((invoice) => (
                      <div key={invoice._id} className="row" style={{ paddingBottom: 8, borderBottom: '1px solid var(--line)', marginBottom: 8 }}>
                        <Link to={`/invoices/${invoice._id}`} className="mono strong">{invoice.invoiceNumber}</Link>
                        <Badge tone={INVOICE_TONE[invoice.status]}>{invoice.status}</Badge>
                        <span className="spacer" />
                        <span className="strong">{formatMoney(invoice.total, invoice.currency)}</span>
                        <span className="small muted" style={{ width: '100%' }}>Due {formatDate(invoice.dueDate)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted small">No invoice has been raised for this ticket.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={editOpen}
        title={`Edit TID ${ticket.ticketNumber}`}
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setEditOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={doEdit} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Save changes
            </button>
          </>
        }
      >
        <Field label="Issue Type" required>
          <Select value={editForm.issueType} onChange={(event) => setEditForm((f) => ({ ...f, issueType: event.target.value }))}>
            {(meta?.issueTypes ?? []).map((t) => <option key={t._id} value={t.name}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority" required>
          <Select value={editForm.priority} onChange={(event) => setEditForm((f) => ({ ...f, priority: event.target.value }))}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field
          label="Status"
          required
          hint={
            ['Resolved', 'Closed'].includes(editForm.status)
              ? 'To record resolution remarks, use the Resolve button instead.'
              : undefined
          }
        >
          <Select value={editForm.status} onChange={(event) => setEditForm((f) => ({ ...f, status: event.target.value }))}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="ETTR" required hint="Recalculated from the ticket's original creation time.">
          <Select value={String(editForm.ettrMinutes)} onChange={(event) => setEditForm((f) => ({ ...f, ettrMinutes: event.target.value }))}>
            {(meta?.ettrPresets ?? [{ label: ettrLabel(editForm.ettrMinutes), minutes: editForm.ettrMinutes }]).map((preset) => (
              <option key={preset.minutes} value={preset.minutes}>{preset.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Remarks" hint="What the NOC operator observed — appears on the generated ticket.">
          <Textarea value={editForm.remarks} onChange={(event) => setEditForm((f) => ({ ...f, remarks: event.target.value }))} rows={3} />
        </Field>
        <Field label="Assigned to" hint="Only members with a login account can be assigned. This is the name shown on the ticket.">
          <Select value={editForm.assignedTo} onChange={(event) => setEditForm((f) => ({ ...f, assignedTo: event.target.value }))}>
            <option value="">Unassigned</option>
            {teams.map((t) => (
              <option key={t._id} value={t._id}>{t.name}{t.area ? ` — ${t.area}` : ''} ({t.openTickets} open)</option>
            ))}
          </Select>
        </Field>
        <Field label="Helper (optional)" hint="Sees this ticket too, but is never named on the ticket itself.">
          <Select
            value={editForm.assignedHelper}
            onChange={(event) => setEditForm((f) => ({ ...f, assignedHelper: event.target.value }))}
            disabled={!editForm.assignedTo}
          >
            <option value="">— none —</option>
            {teams.filter((t) => t._id !== editForm.assignedTo).map((t) => (
              <option key={t._id} value={t._id}>{t.name}{t.area ? ` — ${t.area}` : ''} ({t.openTickets} open)</option>
            ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={assignOpen}
        title={`Assign TID ${ticket.ticketNumber}`}
        onClose={() => setAssignOpen(false)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setAssignOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={doAssign} disabled={busy || !assignTo}>
              {busy ? <span className="spinner" /> : null} Assign
            </button>
          </>
        }
      >
        <Field label="Assigned to" required hint="Only members with a login account can be assigned. This is the name shown on the ticket.">
          <Select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}>
            <option value="">Select…</option>
            {teams.map((t) => (
              <option key={t._id} value={t._id}>{t.name}{t.area ? ` — ${t.area}` : ''} ({t.openTickets} open)</option>
            ))}
          </Select>
        </Field>
        <Field label="Helper (optional)" hint="Sees this ticket too, but is never named on the ticket itself.">
          <Select value={assignHelper} onChange={(event) => setAssignHelper(event.target.value)}>
            <option value="">— none —</option>
            {teams.filter((t) => t._id !== assignTo).map((t) => (
              <option key={t._id} value={t._id}>{t.name}{t.area ? ` — ${t.area}` : ''} ({t.openTickets} open)</option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" hint="Stored in the ticket audit trail.">
          <TextInput value={assignNote} onChange={(event) => setAssignNote(event.target.value)} placeholder="Dispatch immediately" />
        </Field>
      </Modal>

      <Modal
        open={resolveOpen}
        title={`Resolve TID ${ticket.ticketNumber}`}
        onClose={() => setResolveOpen(false)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setResolveOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={doResolve} disabled={busy || !resolution.trim()}>
              {busy ? <span className="spinner" /> : null} Mark {resolveStatus}
            </button>
          </>
        }
      >
        <Field label="Outcome" required>
          <Select value={resolveStatus} onChange={(event) => setResolveStatus(event.target.value)}>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </Select>
        </Field>
        <Field label="Resolution remarks" required hint="What was done in the field. This stops the ETTR countdown.">
          <Textarea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={4} placeholder="Fiber spliced at Shahid Town, link restored and tested." />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleting}
        title="Permanently delete this ticket?"
        message={`TID ${ticket.ticketNumber} will be permanently deleted. This is blocked if any invoices are linked to it, and the action is audited. This cannot be undone.`}
        confirmLabel="Delete ticket"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}

function AiPanel({ ai, busy, onRetry }) {
  const status = ai?.status || 'pending';

  if (status === 'pending') {
    return (
      <div className="row">
        <span className="spinner spinner--dark" />
        <span className="small muted">Analysis in progress…</span>
      </div>
    );
  }

  if (status !== 'completed') {
    return (
      <>
        <Alert tone={status === 'failed' ? 'warn' : 'info'} title={status === 'failed' ? 'AI analysis failed' : 'AI unavailable'}>
          {ai?.error || 'The AI assistant is not configured on the server.'}
        </Alert>
        <div className="small muted">The ticket was created normally — AI never blocks the workflow.</div>
        {onRetry ? (
          <button className="btn btn--secondary btn--sm" style={{ marginTop: 10 }} onClick={onRetry} disabled={busy}>
            {busy ? <span className="spinner spinner--dark" /> : null} Retry analysis
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="ai-panel">
      <div className="deflist">
        <DefItem label="Suggested category" value={ai.category} />
        <DefItem label="Suggested priority" value={ai.suggestedPriority} />
      </div>
      {ai.summary ? <div><div className="deflist__label">Summary</div><div>{ai.summary}</div></div> : null}
      {ai.troubleshootingSteps?.length ? (
        <div>
          <div className="deflist__label">Recommended steps</div>
          <ol className="ai-steps">
            {ai.troubleshootingSteps.map((step, index) => <li key={index}>{step}</li>)}
          </ol>
        </div>
      ) : null}
      {ai.customerResponse ? (
        <div>
          <div className="deflist__label">Suggested customer update</div>
          <div className="ai-quote">{ai.customerResponse}</div>
        </div>
      ) : null}
      <div className="small muted">Suggestions only — the operator decides. Model: {ai.model || 'n/a'}</div>
      {onRetry ? (
        <button className="btn btn--secondary btn--sm" onClick={onRetry} disabled={busy}>Re-run analysis</button>
      ) : null}
    </div>
  );
}

function aiTone(status) {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'info';
  return 'neutral';
}

function labelAction(entry) {
  switch (entry.action) {
    case 'created': return 'Ticket created';
    case 'assigned': return `Assigned to ${entry.to}${entry.from && entry.from !== 'unassigned' ? ` (was ${entry.from})` : ''}`;
    case 'status_change': return `Status changed ${entry.from} → ${entry.to}`;
    case 'ettr_change': return `ETTR changed ${entry.from} → ${entry.to}`;
    case 'resolved': return `Ticket ${entry.to.toLowerCase()}`;
    case 'priority_change': return `Priority changed ${entry.from} → ${entry.to}`;
    case 'issueType_change': return `Issue type changed ${entry.from} → ${entry.to}`;
    case 'remarks_change': return 'Remarks updated';
    default: return entry.action.replace(/_/g, ' ');
  }
}
