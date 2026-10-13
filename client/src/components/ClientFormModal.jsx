import { useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, Modal, Textarea, TextInput } from './ui.jsx';
import { THEME_PRESETS } from '../utils/theme.js';

const BLANK = {
  name: '', contactName: '', phone: '', notes: '', themeColor: '', isActive: true,
};

/** Owner-only: create a client company or edit one (`client` null = new). */
export default function ClientFormModal({ open, client, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError('');
    setForm(client
      ? {
        name: client.name,
        contactName: client.contactName || '',
        phone: client.phone || '',
        notes: client.notes || '',
        themeColor: client.themeColor || '',
        isActive: client.isActive,
      }
      : BLANK);
  }, [open, client]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    setError('');
    try {
      let saved;
      if (client) {
        ({ data: { tenant: saved } } = await api.put(`/tenants/${client._id}`, form));
        toast.success('Client updated', form.name);
      } else {
        ({ data: { tenant: saved } } = await api.post('/tenants', form));
        toast.success('Client created', `${form.name} — now add its login from Logins`);
      }
      onSaved(saved);
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
      title={client ? `Edit ${client.name}` : 'New client'}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : null} {client ? 'Save changes' : 'Create client'}
          </button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="form-grid">
        <Field label="Company name" required error={errors.name} full>
          <TextInput value={form.name} onChange={set('name')} error={errors.name} autoFocus />
        </Field>
        <Field label="Contact person" error={errors.contactName}>
          <TextInput value={form.contactName} onChange={set('contactName')} error={errors.contactName} />
        </Field>
        <Field label="Phone" error={errors.phone}>
          <TextInput value={form.phone} onChange={set('phone')} error={errors.phone} />
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
        {client ? (
          <Field label="Status" full hint="Suspending a client blocks all of its logins immediately; no data is deleted.">
            <label className="checkbox">
              <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
              Active — its users can sign in
            </label>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
