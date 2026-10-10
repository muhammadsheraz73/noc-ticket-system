import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, EmptyState, Field, Loading, Modal, Textarea, TextInput,
} from '../components/ui.jsx';
import { formatDateTime } from '../utils/format.js';
import { THEME_PRESETS, fileToLogoDataUrl } from '../utils/theme.js';

const BLANK = {
  name: '', contactName: '', phone: '', notes: '', logo: '', themeColor: '', isActive: true,
};

/** Owner-only: the companies this panel has been sold to. */
export default function ClientsPage() {
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/tenants');
      setItems(data.items);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openForm = (client) => {
    setEditing(client || null);
    setForm(client
      ? {
        name: client.name,
        contactName: client.contactName || '',
        phone: client.phone || '',
        notes: client.notes || '',
        logo: client.logo || '',
        themeColor: client.themeColor || '',
        isActive: client.isActive,
      }
      : BLANK);
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (editing) {
        await api.put(`/tenants/${editing._id}`, form);
        toast.success('Client updated', form.name);
      } else {
        await api.post('/tenants', form);
        toast.success('Client created', form.name);
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save the client', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pickLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const logo = await fileToLogoDataUrl(file);
      setForm((f) => ({ ...f, logo }));
    } catch (err) {
      toast.error('Logo not added', err.message);
    }
  };

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  if (loading && items.length === 0 && !error) return <Loading label="Loading clients…" />;

  return (
    <>
      <PageHead
        title="Clients"
        subtitle="Each client is a separate company: its logins only ever see that company's own tickets, customers, billing and network."
        actions={<button className="btn" onClick={() => openForm(null)}>＋ New client</button>}
      />

      {error ? <Alert tone="error" title="Could not load clients">{error}</Alert> : null}

      <div className="card">
        <div className="card__body card__body--flush">
          {items.length === 0 ? (
            <EmptyState icon="🏢" title="No clients yet" message="Create the first client, then add its login." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th><th>Branding</th><th>Contact</th><th>Logins</th><th>Status</th><th>Added</th><th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((client) => (
                    <tr key={client._id}>
                      <td className="strong">{client.name}</td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap', gap: 8, alignItems: 'center' }}>
                          {client.logo
                            ? <img src={client.logo} alt="" style={{ height: 28, maxWidth: 80, objectFit: 'contain' }} />
                            : <span className="small muted">no logo</span>}
                          {client.themeColor ? (
                            <span
                              title={client.themeColor}
                              style={{
                                width: 18, height: 18, borderRadius: 4, background: client.themeColor,
                                border: '1px solid var(--line)',
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div>{client.contactName || '—'}</div>
                        <div className="small muted">{client.phone || ''}</div>
                      </td>
                      <td>{client.userCount}</td>
                      <td>
                        <Badge tone={client.isActive ? 'ok' : 'neutral'}>
                          {client.isActive ? 'Active' : 'Suspended'}
                        </Badge>
                      </td>
                      <td className="small muted nowrap">{formatDateTime(client.createdAt)}</td>
                      <td>
                        <div className="table__actions">
                          <button className="btn btn--secondary btn--sm" onClick={() => openForm(client)}>
                            Edit
                          </button>
                          <Link className="btn btn--ghost btn--sm" to="/users">Logins</Link>
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
        title={editing ? `Edit ${editing.name}` : 'New client'}
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
          <Field label="Company name" required error={errors.name} full>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} />
          </Field>
          <Field label="Contact person" error={errors.contactName}>
            <TextInput value={form.contactName} onChange={set('contactName')} error={errors.contactName} />
          </Field>
          <Field label="Phone" error={errors.phone}>
            <TextInput value={form.phone} onChange={set('phone')} error={errors.phone} />
          </Field>
          <Field
            label="Logo"
            error={errors.logo}
            hint="PNG, JPEG or WebP. Shown in the sidebar and on invoices; it is shrunk automatically."
            full
          >
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 120, height: 56, border: '1px dashed var(--line-strong)', borderRadius: 8,
                  display: 'grid', placeItems: 'center', background: '#fff',
                }}
              >
                {form.logo
                  ? <img src={form.logo} alt="Logo preview" style={{ maxWidth: 110, maxHeight: 48 }} />
                  : <span className="small muted">No logo</span>}
              </div>
              <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer' }}>
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={pickLogo}
                  style={{ display: 'none' }}
                />
              </label>
              {form.logo ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setForm((f) => ({ ...f, logo: '' }))}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </Field>
          <Field
            label="Colour theme"
            error={errors.themeColor}
            hint="The whole panel (sidebar, buttons, highlights) and this client's invoices use this colour."
            full
          >
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.color}
                  type="button"
                  title={preset.name}
                  onClick={() => setForm((f) => ({ ...f, themeColor: preset.color }))}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: preset.color,
                    cursor: 'pointer',
                    border: form.themeColor === preset.color
                      ? '3px solid var(--ink)'
                      : '1px solid var(--line-strong)',
                  }}
                />
              ))}
              <input
                type="color"
                value={form.themeColor || '#e35a00'}
                onChange={(event) => setForm((f) => ({ ...f, themeColor: event.target.value }))}
                title="Custom colour"
                style={{ width: 36, height: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              />
              {form.themeColor ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setForm((f) => ({ ...f, themeColor: '' }))}
                >
                  Default
                </button>
              ) : null}
            </div>
          </Field>
          <Field label="Notes" error={errors.notes} full>
            <Textarea rows={3} value={form.notes} onChange={set('notes')} error={errors.notes} />
          </Field>
          {editing ? (
            <Field label="Status" full hint="Suspending a client blocks all of its logins immediately; no data is deleted.">
              <label className="checkbox">
                <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
                Active — its users can sign in
              </label>
            </Field>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
