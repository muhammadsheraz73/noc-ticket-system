import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Field, Loading, Modal, TextInput,
} from '../components/ui.jsx';
import { CredentialsModal, generatePassword, suggestUsername } from '../components/Credentials.jsx';
import { formatDateTime } from '../utils/format.js';

const BLANK = { name: '', username: '', email: '', password: '', phone: '', isActive: true };

/**
 * The client admin's billing department: Accounts logins that open a
 * billing-only panel (Billing, Invoices, Quotations) on this client's data.
 */
export default function TeamPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [resetting, setResetting] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [credentials, setCredentials] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/team');
      setItems(data.items);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = (member) => {
    setEditing(member || null);
    setForm(member
      ? {
        name: member.name,
        username: member.username || '',
        email: member.email,
        password: '',
        phone: member.phone || '',
        isActive: member.isActive,
      }
      : { ...BLANK, password: generatePassword() });
    setErrors({});
    setUsernameTouched(Boolean(member));
    setShowPassword(!member);
    setFormOpen(true);
  };

  const handOver = (title, member, password) => {
    setCredentials({
      title, name: member.name, username: member.username, email: member.email, password,
    });
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (editing) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        const { data } = await api.put(`/team/${editing._id}`, payload);
        toast.success('Team member updated', data.user.username);
        setFormOpen(false);
        if (form.password) handOver('Password updated', data.user, form.password);
      } else {
        const { data } = await api.post('/team', form);
        toast.success('Billing login created', data.user.name);
        setFormOpen(false);
        handOver('Billing login created', data.user, form.password);
      }
      load();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (member) => {
    try {
      await api.put(`/team/${member._id}`, { isActive: !member.isActive });
      toast.success(member.isActive ? `${member.name} can no longer sign in` : `${member.name} can sign in again`);
      load();
    } catch (err) {
      toast.error('Could not update', errorMessage(err));
    }
  };

  const submitReset = async () => {
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post(`/team/${resetting._id}/reset-password`, { password: resetPassword });
      toast.success('Password reset', data.user.username);
      setResetting(null);
      handOver('Password reset', data.user, resetPassword);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not reset the password', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/team/${deleting._id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setName = (event) => {
    const { value } = event.target;
    setForm((f) => ({ ...f, name: value, username: usernameTouched ? f.username : suggestUsername(value) }));
  };

  if (loading && items.length === 0 && !error) return <Loading label="Loading billing team…" />;

  return (
    <>
      <PageHead
        title="Billing Team"
        subtitle={`Logins for the ${user?.tenantName || 'company'} billing department. They see Billing (monthly bills), Invoices and Quotations. Monthly bills are run only from their panel; invoices and quotations they create also show up here in yours.`}
        actions={<button className="btn" onClick={() => openForm(null)}>＋ New billing login</button>}
      />

      {error ? <Alert tone="error" title="Could not load the billing team">{error}</Alert> : null}

      <div className="card">
        <div className="card__body card__body--flush">
          {items.length === 0 ? (
            <EmptyState
              icon="💼"
              title="No billing logins yet"
              message="Create a login for your accounts staff. They get their own billing panel with only your invoices, quotations and billing."
              action={<button className="btn" onClick={() => openForm(null)}>＋ New billing login</button>}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Last sign-in</th><th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((member) => (
                    <tr key={member._id}>
                      <td>
                        <div className="strong">{member.name}</div>
                        <div className="small muted">{member.phone || '—'}</div>
                      </td>
                      <td className="mono strong">{member.username}</td>
                      <td className="mono small">{member.email}</td>
                      <td>
                        <Badge tone={member.isActive ? 'ok' : 'neutral'}>{member.isActive ? 'Active' : 'Disabled'}</Badge>
                      </td>
                      <td className="small muted nowrap">
                        {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : 'never'}
                      </td>
                      <td>
                        <div className="table__actions">
                          <button className="btn btn--secondary btn--sm" onClick={() => openForm(member)}>Edit</button>
                          <button
                            className="btn btn--ghost btn--sm"
                            onClick={() => { setResetting(member); setResetPassword(generatePassword()); setErrors({}); }}
                          >
                            Reset password
                          </button>
                          <button className="btn btn--ghost btn--sm" onClick={() => toggleActive(member)}>
                            {member.isActive ? 'Disable' : 'Enable'}
                          </button>
                          <button className="btn btn--ghost btn--sm text-danger" onClick={() => setDeleting(member)}>
                            Delete
                          </button>
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
        title={editing ? `Edit ${editing.name}` : 'New billing login'}
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
            <TextInput value={form.name} onChange={setName} error={errors.name} placeholder="Ali Raza" />
          </Field>
          <Field label="Username" required error={errors.username} hint="What they type to sign in.">
            <TextInput
              value={form.username}
              onChange={(event) => { setUsernameTouched(true); setForm((f) => ({ ...f, username: event.target.value.toLowerCase() })); }}
              error={errors.username}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="ali.raza"
            />
          </Field>
          <Field label="Email" required error={errors.email} hint="Also works as a sign-in.">
            <TextInput type="email" value={form.email} onChange={set('email')} error={errors.email} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <TextInput value={form.phone} onChange={set('phone')} error={errors.phone} />
          </Field>
          <Field
            label={editing ? 'New password' : 'Password'}
            required={!editing}
            error={errors.password}
            hint={editing ? 'Leave blank to keep the current password.' : 'At least 8 characters.'}
            full
          >
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <TextInput
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                autoComplete="new-password"
                style={{ flex: 1, fontFamily: form.password ? 'var(--mono)' : undefined }}
              />
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => { setForm((f) => ({ ...f, password: generatePassword() })); setShowPassword(true); }}
              >
                Generate
              </button>
            </div>
          </Field>
          <Field label="Account status">
            <label className="checkbox">
              <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
              Active — can sign in
            </label>
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(resetting)}
        title={`Reset password — ${resetting?.name || ''}`}
        onClose={() => setResetting(null)}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setResetting(null)} disabled={busy}>Cancel</button>
            <button className="btn" onClick={submitReset} disabled={busy || resetPassword.length < 8}>
              {busy ? <span className="spinner" /> : null} Reset password
            </button>
          </>
        }
      >
        <p className="muted small">
          The old password stops working immediately. Copy the new one on the next screen and pass it
          to <strong>{resetting?.name}</strong>.
        </p>
        <Field label="New password" required error={errors.password} hint="At least 8 characters.">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <TextInput
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              error={errors.password}
              autoComplete="new-password"
              style={{ flex: 1, fontFamily: 'var(--mono)' }}
            />
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setResetPassword(generatePassword())}>
              Generate
            </button>
          </div>
        </Field>
      </Modal>

      <CredentialsModal
        credentials={credentials}
        onClose={() => setCredentials(null)}
        onCopied={(ok) => (ok
          ? toast.success('Credentials copied to clipboard')
          : toast.error('Copy failed', 'Select the text and copy it manually.'))}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Permanently delete this billing login?"
        message={`${deleting?.name} (${deleting?.username}) will no longer be able to sign in. Invoices and quotations they made are kept.`}
        confirmLabel="Delete login"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
