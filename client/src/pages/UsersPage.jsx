import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Field, Loading, Modal, Select, TextInput,
} from '../components/ui.jsx';
import { ROLE_LABELS, formatDateTime } from '../utils/format.js';

const BLANK = {
  name: '', username: '', email: '', password: '', role: 'noc_operator', phone: '', isActive: true,
};

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

  /** Set once the admin edits the username, so it stops tracking the name. */
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  /** Password reset dialog for one user, separate from the full edit form. */
  const [resetting, setResetting] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  /**
   * Credentials to hand over. Shown once after they are issued — the server
   * only ever stores the hash, so this is the single chance to copy them.
   */
  const [credentials, setCredentials] = useState(null);

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
      ? {
        name: user.name,
        username: user.username || '',
        email: user.email,
        password: '',
        role: user.role,
        phone: user.phone || '',
        isActive: user.isActive,
      }
      : { ...BLANK, password: generatePassword() });
    setErrors({});
    setUsernameTouched(Boolean(user));
    setShowPassword(!user);
    setFormOpen(true);
  };

  const openReset = (user) => {
    setResetting(user);
    setResetPassword(generatePassword());
    setErrors({});
  };

  /** Stage the one-time hand-off sheet for a freshly issued password. */
  const handOver = (title, user, password) => {
    setCredentials({
      title, name: user.name, username: user.username, email: user.email, password,
    });
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (editing) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        const { data } = await api.put(`/users/${editing._id}`, payload);
        toast.success('User updated', data.user.username);
        setFormOpen(false);
        // A password typed into the edit form still has to reach the person.
        if (form.password) handOver('Password updated', data.user, form.password);
      } else {
        const { data } = await api.post('/users', form);
        toast.success('User created', `${data.user.name} — ${ROLE_LABELS[data.user.role]}`);
        setFormOpen(false);
        handOver('User created', data.user, form.password);
      }
      load();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save the user', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    setBusy(true);
    setErrors({});
    try {
      const { data } = await api.post(`/users/${resetting._id}/reset-password`, {
        password: resetPassword,
      });
      toast.success('Password reset', data.user.username);
      setResetting(null);
      handOver('Password reset', data.user, resetPassword);
      load();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not reset the password', errorMessage(err));
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

  const setName = (event) => {
    const { value } = event.target;
    setForm((f) => ({
      ...f,
      name: value,
      // The username follows the name until the admin takes it over.
      username: usernameTouched ? f.username : suggestUsername(value),
    }));
  };

  const setUsername = (event) => {
    setUsernameTouched(true);
    setForm((f) => ({ ...f, username: event.target.value.toLowerCase() }));
  };

  if (loading) return <Loading label="Loading users…" />;

  return (
    <>
      <PageHead
        title="Users &amp; roles"
        subtitle="Create accounts, assign a role and hand out the sign-in credentials."
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
                <thead>
                  <tr>
                    <th>Name</th><th>Username</th><th>Email</th><th>Role</th>
                    <th>Status</th><th>Last sign-in</th><th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user._id}>
                      <td>
                        <div className="strong">{user.name}</div>
                        <div className="small muted">
                          {user._id === me._id ? 'that’s you' : user.phone || '—'}
                        </div>
                      </td>
                      <td className="mono strong">{user.username || '—'}</td>
                      <td className="mono small">{user.email}</td>
                      <td><Badge tone={roleTone(user.role)}>{ROLE_LABELS[user.role]}</Badge></td>
                      <td>
                        <Badge tone={user.isActive ? 'ok' : 'neutral'}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="small muted nowrap">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'never'}
                      </td>
                      <td>
                        <div className="table__actions">
                          <button className="btn btn--secondary btn--sm" onClick={() => openForm(user)}>
                            Edit
                          </button>
                          <button className="btn btn--ghost btn--sm" onClick={() => openReset(user)}>
                            Reset password
                          </button>
                          {user._id !== me._id && user.isActive ? (
                            <button
                              className="btn btn--ghost btn--sm text-danger"
                              onClick={() => setDeactivating(user)}
                            >
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
            <TextInput value={form.name} onChange={setName} error={errors.name} />
          </Field>
          <Field
            label="Username"
            required
            error={errors.username}
            hint="What they type to sign in — letters, digits, dot, underscore or hyphen."
          >
            <TextInput
              value={form.username}
              onChange={setUsername}
              error={errors.username}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="usman.tariq"
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
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  setForm((f) => ({ ...f, password: generatePassword() }));
                  setShowPassword(true);
                }}
              >
                Generate
              </button>
            </div>
          </Field>

          <Field label="Role" required error={errors.role} hint="Decides what the account can see and do.">
            <Select value={form.role} onChange={set('role')} error={errors.role}>
              {(roles.length ? roles : Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })))
                .map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </Select>
          </Field>
          <Field label="Account status">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={set('isActive')}
                disabled={editing?._id === me._id}
              />
              Active — can sign in
            </label>
          </Field>

          <div className="form-grid--full">
            <Alert tone="info" title={`${ROLE_LABELS[form.role]} access`}>{ROLE_ACCESS[form.role]}</Alert>
          </div>
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
          to <strong>{resetting?.name}</strong> — it cannot be shown again.
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
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setResetPassword(generatePassword())}
            >
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
        open={Boolean(deactivating)}
        title="Deactivate this account?"
        message={`${deactivating?.name} (${deactivating?.username}) will no longer be able to sign in. The action is audited.`}
        confirmLabel="Deactivate"
        busy={busy}
        onConfirm={deactivate}
        onCancel={() => setDeactivating(null)}
      />
    </>
  );
}

/** One-time hand-off sheet: the password exists nowhere else once this closes. */
function CredentialsModal({ credentials, onClose, onCopied }) {
  if (!credentials) return null;

  const sheet = [
    'NOC Manager — sign in',
    `URL      : ${window.location.origin}`,
    `Username : ${credentials.username}`,
    `Email    : ${credentials.email}`,
    `Password : ${credentials.password}`,
  ].join('\n');

  return (
    <Modal
      open
      title={credentials.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={() => copyText(sheet, onCopied)}>
            📋 Copy credentials
          </button>
          <button className="btn" onClick={onClose}>Done</button>
        </>
      }
    >
      <Alert tone="warn" title="Shown only once">
        {`The server stores a hash, not the password. Copy it now and give it to ${credentials.name} — reopening this page cannot show it again.`}
      </Alert>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, userSelect: 'all' }}>{sheet}</pre>
    </Modal>
  );
}

async function copyText(text, onCopied) {
  try {
    await navigator.clipboard.writeText(text);
    onCopied?.(true);
  } catch {
    // The Clipboard API needs a secure context; fall back to a temporary textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    onCopied?.(ok);
  }
}

/** "Usman Tariq" → "usman.tariq", matching the server's username rules. */
function suggestUsername(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^[.]+|[.]+$/g, '')
    .slice(0, 32);
}

// Look-alike characters (0/O, 1/l/I) are left out — these get read off a screen
// and typed by hand, often over the phone.
const PASSWORD_CLASSES = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%&*?',
];

/** Random password holding at least one character from every class. */
function generatePassword(length = 14) {
  const all = PASSWORD_CLASSES.join('');
  const picks = [
    ...PASSWORD_CLASSES.map(pickChar),
    ...Array.from({ length: length - PASSWORD_CLASSES.length }, () => pickChar(all)),
  ];

  // Shuffle, otherwise the guaranteed characters always sit in class order.
  for (let i = picks.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.join('');
}

function pickChar(chars) {
  return chars[randomInt(chars.length)];
}

function randomInt(max) {
  const buffer = new Uint32Array(1);
  window.crypto.getRandomValues(buffer);
  return buffer[0] % max;
}

const ROLE_ACCESS = {
  admin: 'Everything — tickets, customers, network inventory, billing and user management.',
  noc_operator: 'Tickets and customers (create, assign, resolve), field teams, network inventory, and invoices read-only.',
  field_engineer: 'Only the tickets assigned to them, plus the field team directory. No billing, no network inventory.',
  accounts: 'Invoices (create, edit, mark paid) and customer records. No tickets, no network inventory.',
};

function roleTone(role) {
  return { admin: 'purple', noc_operator: 'info', field_engineer: 'warn', accounts: 'ok' }[role] || 'neutral';
}
