import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Countdown from '../components/Countdown.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Field, Loading, Modal, Select, TextInput, Textarea,
} from '../components/ui.jsx';
import { STATUS_TONE, PRIORITY_TONE, formatDateTime } from '../utils/format.js';

const BLANK = { name: '', kind: 'member', team: '', phone: '', email: '', area: '', user: '', notes: '' };

export default function FieldTeamsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, canManageTickets, isAdmin } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const [myTickets, setMyTickets] = useState([]);
  const isField = user.role === ROLES.FIELD_ENGINEER;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/field-teams');
      setItems(data.items);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isAdmin) api.get('/users').then(({ data }) => setUsers(data.items)).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (isField) {
      api.get('/tickets', { params: { open: 'true', limit: 50 } })
        .then(({ data }) => setMyTickets(data.items))
        .catch(() => {});
    }
  }, [isField]);

  const openForm = (member) => {
    setEditing(member || null);
    setForm(member ? { ...BLANK, ...pick(member) } : BLANK);
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = { ...form, team: form.team || undefined, user: form.user || undefined };
      if (editing) {
        await api.put(`/field-teams/${editing._id}`, payload);
        toast.success('Field record updated', form.name);
      } else {
        await api.post('/field-teams', payload);
        toast.success('Field record created', form.name);
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await api.delete(`/field-teams/${deactivating._id}`);
      toast.success(`${deactivating.name} deactivated`);
      setDeactivating(null);
      load();
    } catch (err) {
      toast.error('Could not deactivate', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  if (loading) return <Loading label="Loading field team…" />;

  const teams = items.filter((i) => i.kind === 'team');
  const members = items.filter((i) => i.kind === 'member');

  return (
    <>
      <PageHead
        title={isField ? 'My assigned work' : 'Field team'}
        subtitle={isField ? 'Tickets currently assigned to you.' : 'Teams and members available for ticket assignment.'}
        actions={canManageTickets ? <button className="btn" onClick={() => openForm(null)}>＋ Add team / member</button> : null}
      />

      {error ? <Alert tone="error" title="Could not load the field team">{error}</Alert> : null}

      <div className="stack">
        {isField ? (
          <div className="card">
            <div className="card__head"><h2>My open tickets</h2></div>
            <div className="card__body card__body--flush">
              {myTickets.length === 0 ? (
                <EmptyState icon="✅" title="Nothing assigned right now" message="You have no open tickets." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>TID</th><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>ETTR</th><th>Time Left</th></tr></thead>
                    <tbody>
                      {myTickets.map((ticket) => (
                        <tr key={ticket._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tickets/${ticket.ticketNumber}`)}>
                          <td><span className="tid">{ticket.ticketNumber}</span></td>
                          <td>
                            <div className="strong">{ticket.customerName}</div>
                            <div className="small muted">{ticket.customerReferenceNumber}</div>
                          </td>
                          <td>{ticket.issueType}</td>
                          <td><Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge></td>
                          <td><Badge tone={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></td>
                          <td className="nowrap small">{formatDateTime(ticket.ettrAt)}</td>
                          <td><Countdown ettrAt={ticket.ettrAt} frozen={ticket.timeLeft.frozen} frozenAt={ticket.resolvedAt} short /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card__head"><h2>Members</h2></div>
          <div className="card__body card__body--flush">
            {members.length === 0 ? (
              <EmptyState icon="🔧" title="No field members yet" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Team</th><th>Area</th><th>Phone</th><th>Open tickets</th><th /></tr></thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member._id}>
                        <td>
                          <div className="strong">{member.name}</div>
                          {member.user ? (
                            <div className="small muted">{member.user.email}</div>
                          ) : (
                            <Badge tone="neutral">No login — can't be assigned</Badge>
                          )}
                        </td>
                        <td>{member.team?.name || <span className="muted">—</span>}</td>
                        <td>{member.area || <span className="muted">—</span>}</td>
                        <td className="mono">{member.phone || '—'}</td>
                        <td>
                          <Badge tone={member.openTickets > 3 ? 'warn' : member.openTickets ? 'info' : 'neutral'}>
                            {member.openTickets}
                          </Badge>
                        </td>
                        <td>
                          <div className="table__actions">
                            <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/tickets?q=${encodeURIComponent(member.name)}`)}>
                              Tickets
                            </button>
                            {canManageTickets ? <button className="btn btn--secondary btn--sm" onClick={() => openForm(member)}>Edit</button> : null}
                            {isAdmin ? <button className="btn btn--ghost btn--sm text-danger" onClick={() => setDeactivating(member)}>Deactivate</button> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2>Teams</h2></div>
          <div className="card__body card__body--flush">
            {teams.length === 0 ? (
              <EmptyState icon="👷" title="No teams yet" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Team</th><th>Area</th><th>Members</th><th>Open tickets</th><th /></tr></thead>
                  <tbody>
                    {teams.map((team) => (
                      <tr key={team._id}>
                        <td className="strong">{team.name}</td>
                        <td>{team.area || <span className="muted">—</span>}</td>
                        <td>{members.filter((m) => m.team?._id === team._id).length}</td>
                        <td><Badge tone="neutral">{team.openTickets}</Badge></td>
                        <td>
                          <div className="table__actions">
                            {canManageTickets ? <button className="btn btn--secondary btn--sm" onClick={() => openForm(team)}>Edit</button> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={formOpen}
        title={editing ? `Edit ${editing.name}` : 'Add field team or member'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy || !form.name.trim()}>
              {busy ? <span className="spinner" /> : null} Save
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Name" required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} placeholder="Sharafat Ali" />
          </Field>
          <Field label="Record type" required>
            <Select value={form.kind} onChange={set('kind')}>
              <option value="member">Member</option>
              <option value="team">Team</option>
            </Select>
          </Field>
          {form.kind === 'member' ? (
            <Field label="Belongs to team">
              <Select value={form.team} onChange={set('team')}>
                <option value="">— none —</option>
                {teams.map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Area">
            <TextInput value={form.area} onChange={set('area')} placeholder="Gajjumata" />
          </Field>
          <Field label="Phone">
            <TextInput value={form.phone} onChange={set('phone')} placeholder="0301-3334455" />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={form.email} onChange={set('email')} />
          </Field>
          {isAdmin && form.kind === 'member' ? (
            <Field label="Link to login account" hint="Lets this person sign in and see only their own tickets." full>
              <Select value={form.user} onChange={set('user')}>
                <option value="">— no login account —</option>
                {users.filter((u) => u.role === ROLES.FIELD_ENGINEER).map((u) => (
                  <option key={u._id} value={u._id}>{u.name} ({u.email})</option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Notes" full>
            <Textarea value={form.notes} onChange={set('notes')} rows={2} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivating)}
        title="Deactivate this record?"
        message={`${deactivating?.name} will no longer appear in assignment lists. Ticket history is kept.`}
        confirmLabel="Deactivate"
        busy={busy}
        onConfirm={deactivate}
        onCancel={() => setDeactivating(null)}
      />
    </>
  );
}

function pick(member) {
  return {
    name: member.name ?? '',
    kind: member.kind ?? 'member',
    team: member.team?._id ?? member.team ?? '',
    phone: member.phone ?? '',
    email: member.email ?? '',
    area: member.area ?? '',
    user: member.user?._id ?? member.user ?? '',
    notes: member.notes ?? '',
  };
}
