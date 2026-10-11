import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Field, Loading, Modal, TextInput, Textarea,
} from '../components/ui.jsx';

const BLANK = { name: '', phone: '', email: '', area: '', notes: '' };

/**
 * The people tickets can be assigned to. Every active employee here appears in
 * the "Assign To" and "Helper" pickers when creating or reassigning a ticket.
 */
export default function EmployeesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new employee
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/field-teams', { params: { kind: 'member', active: 'all' } });
      setItems(data.items);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((e) => {
      if (!showInactive && !e.isActive) return false;
      if (!q) return true;
      return [e.name, e.phone, e.email, e.area].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [items, query, showInactive]);

  const activeCount = items.filter((e) => e.isActive).length;
  const inactiveCount = items.length - activeCount;

  const confirmRemove = async () => {
    setBusy(true);
    try {
      await api.delete(`/field-teams/${removing._id}`);
      toast.success('Employee removed', removing.name);
      setRemoving(null);
      load();
    } catch (err) {
      toast.error('Could not remove the employee', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (employee) => {
    try {
      await api.put(`/field-teams/${employee._id}`, { isActive: true });
      toast.success('Employee restored', employee.name);
      load();
    } catch (err) {
      toast.error('Could not restore the employee', errorMessage(err));
    }
  };

  return (
    <>
      <PageHead
        title="Employees"
        subtitle="Everyone added here can be picked in “Assign To” and “Helper” when creating a ticket."
        actions={<button className="btn" onClick={() => setEditing(null)}>＋ Add Employee</button>}
      />

      {error ? <Alert tone="error" title="Could not load employees">{error}</Alert> : null}

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, phone, email, designation…"
              />
            </Field>
          </div>
          {inactiveCount ? (
            <div className="filters__item" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
              <label className="checkbox">
                <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
                Show removed ({inactiveCount})
              </label>
            </div>
          ) : null}
        </div>

        <div className="card__body card__body--flush">
          {loading ? (
            <Loading label="Loading employees…" />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="🧑‍🔧"
              title={query ? 'No employees found' : 'No employees yet'}
              message={query ? 'Nothing matches this search.' : 'Add your team so tickets can be assigned to them.'}
              action={!query ? <button className="btn" onClick={() => setEditing(null)}>＋ Add Employee</button> : null}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th><th>Designation / Area</th><th>Phone</th><th className="text-right">Open tickets</th><th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e._id}>
                      <td>
                        <div className="strong">{e.name}</div>
                        {e.email ? <div className="small muted">{e.email}</div> : null}
                      </td>
                      <td className="small">{e.area || '—'}</td>
                      <td className="small nowrap">{e.phone || '—'}</td>
                      <td className="text-right mono">{e.openTickets}</td>
                      <td>
                        {e.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Removed</Badge>}
                        {e.user ? <> <Badge tone="info">Has login</Badge></> : null}
                      </td>
                      <td>
                        <div className="table__actions">
                          <button className="btn btn--ghost btn--sm" onClick={() => setEditing(e)}>Edit</button>
                          {e.isActive ? (
                            user?.role === ROLES.ADMIN ? (
                              <button className="btn btn--ghost btn--sm text-danger" onClick={() => setRemoving(e)}>Remove</button>
                            ) : null
                          ) : (
                            <button className="btn btn--secondary btn--sm" onClick={() => restore(e)}>Restore</button>
                          )}
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

      <EmployeeFormModal
        open={editing !== undefined}
        employee={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => { setEditing(undefined); load(); }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove this employee?"
        message={removing ? `${removing.name} will no longer appear in Assign To / Helper. Their ticket history is kept, and you can restore them later.` : ''}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

function EmployeeFormModal({ open, employee, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError('');
    setForm(employee
      ? { name: employee.name, phone: employee.phone || '', email: employee.email || '', area: employee.area || '', notes: employee.notes || '' }
      : BLANK);
  }, [open, employee]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      if (employee) {
        await api.put(`/field-teams/${employee._id}`, form);
        toast.success('Employee updated', form.name);
      } else {
        await api.post('/field-teams', { ...form, kind: 'member' });
        toast.success('Employee added', form.name);
      }
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={employee ? `Edit ${employee.name}` : 'Add Employee'}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {employee ? 'Save changes' : 'Add Employee'}
          </button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Name" required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} required autoFocus placeholder="Ali Raza" />
          </Field>
          <Field label="Designation / Area" error={errors.area} hint="Shown next to the name in Assign To">
            <TextInput value={form.area} onChange={set('area')} error={errors.area} placeholder="Field Technician — Shahid Town" />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <TextInput value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="03xx-xxxxxxx" />
          </Field>
          <Field label="Email" error={errors.email}>
            <TextInput type="email" value={form.email} onChange={set('email')} error={errors.email} />
          </Field>
          <Field label="Notes" error={errors.notes} full>
            <Textarea rows={2} value={form.notes} onChange={set('notes')} error={errors.notes} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
