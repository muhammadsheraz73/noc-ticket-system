import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Field, Loading, Modal, Select, TextInput,
} from '../components/ui.jsx';
import { ROLE_LABELS, formatDateTime } from '../utils/format.js';

const BLANK = { name: '', email: '', password: '', role: 'noc_operator', phone: '', isActive: true };

export default function UsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();

  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/users');
      setItems(data.items);
      setRoles(data.roles);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = (user) => {
    setEditing(user || null);
    setForm(user
      ? { name: user.name, email: user.email, password: '', role: user.role, phone: user.phone || '', isActive: user.isActive }
      : BLANK);
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (editing) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await api.put(`/users/${editing._id}`, payload);
        toast.success('User updated', form.email);
      } else {
        await api.post('/users', form);
        toast.success('User created', `${form.name} — ${ROLE_LABELS[form.role]}`);
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save the user', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      await api.delete(`/users/${deactivating._id}`);
      toast.success(`${deactivating.name} deactivated`);
      setDeactivating(null);
      load();
    } catch (err) {
      toast.error('Could not deactivate', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  if (loading) return <Loading label="Loading users…" />;

  return (
    <>
      <PageHead
        title="Users &amp; roles"
        subtitle="Admin, NOC Operator, Field Engineer and Accounts accounts."
        actions={<button className="btn" onClick={() => openForm(null)}>＋ New user</button>}
      />

      {error ? <Alert tone="error" title="Could not load users">{error}</Alert> : null}

      <div className="card">
        <div className="card__body card__body--flush">
          {items.length === 0 ? (
            <EmptyState icon="🛡" title="No users yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user._id}>
                      <td>
                        <div className="strong">{user.name}</div>
                        {user._id === me._id ? <div className="small muted">that&apos;s you</div> : null}
                      </td>
                      <td className="mono small">{user.email}</td>
                      <td><Badge tone={roleTone(user.role)}>{ROLE_LABELS[user.role]}</Badge></td>
                      <td className="mono small">{user.phone || '—'}</td>
                      <td><Badge tone={user.isActive ? 'ok' : 'neutral'}>{user.isActive ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="small muted nowrap">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'never'}</td>
                      <td>
                        <div className="table__actions">
                          <button className="btn btn--secondary btn--sm" onClick={() => openForm(user)}>Edit</button>
                          {user._id !== me._id && user.isActive ? (
                            <button className="btn btn--ghost btn--sm text-danger" onClick={() => setDeactivating(user)}>
                              Deactivate
                            </button>
                          ) : null}
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

      <Modal
        open={formOpen}
        title={editing ? `Edit ${editing.name}` : 'New user'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Save
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Full name" required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} />
          </Field>
          <Field label="Email" required error={errors.email}>
            <TextInput type="email" value={form.email} onChange={set('email')} error={errors.email} />
          </Field>
          <Field
            label={editing ? 'New password' : 'Password'}
            required={!editing}
            error={errors.password}
            hint={editing ? 'Leave blank to keep the current password.' : 'At least 8 characters.'}
          >
            <TextInput type="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete="new-password" />
          </Field>
          <Field label="Role" required error={errors.role}>
            <Select value={form.role} onChange={set('role')} error={errors.role}>
              {(roles.length ? roles : Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })))
                .map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </Select>
          </Field>
          <Field label="Phone" error={errors.phone}>
            <TextInput value={form.phone} onChange={set('phone')} error={errors.phone} />
          </Field>
          <Field label="Account status" full>
            <label className="checkbox">
              <input type="checkbox" checked={form.isActive} onChange={set('isActive')} disabled={editing?._id === me._id} />
              Active — can sign in
            </label>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivating)}
        title="Deactivate this account?"
        message={`${deactivating?.name} (${deactivating?.email}) will no longer be able to sign in. The action is audited.`}
        confirmLabel="Deactivate"
        busy={busy}
        onConfirm={deactivate}
        onCancel={() => setDeactivating(null)}
      />
    </>
  );
}

function roleTone(role) {
  return { admin: 'purple', noc_operator: 'info', field_engineer: 'warn', accounts: 'ok' }[role] || 'neutral';
}
