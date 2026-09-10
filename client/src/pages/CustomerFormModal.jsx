import { useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, Modal, Select, TextInput, Textarea } from '../components/ui.jsx';

const BLANK = {
  customerReferenceNumber: '',
  name: '',
  address: '',
  connectedFrom: '',
  type: 'PUM',
  contactNumber: '',
  location: '',
  sourcePort: '',
  destinationPort: '',
  vlan: '',
  notes: '',
};

export default function CustomerFormModal({ open, customer, types = [], onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError('');
    setForm(customer ? { ...BLANK, ...pick(customer) } : BLANK);
  }, [open, customer]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      if (customer) {
        await api.put(`/customers/${customer._id}`, form);
        toast.success('Customer updated', form.customerReferenceNumber);
      } else {
        await api.post('/customers', form);
        toast.success('Customer created', `${form.customerReferenceNumber} — ${form.name}`);
      }
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const typeOptions = [...new Set([...types, 'PUM', 'PMB', 'COR', form.type].filter(Boolean))];

  return (
    <Modal
      open={open}
      title={customer ? `Edit customer ${customer.customerReferenceNumber}` : 'New customer'}
      onClose={busy ? undefined : onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {customer ? 'Save changes' : 'Create customer'}
          </button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      <form onSubmit={submit}>
        <fieldset className="fieldset">
          <legend>Customer information</legend>
          <div className="form-grid">
            <Field label="Customer Reference Number" required error={errors.customerReferenceNumber} hint="Unique identifier, e.g. 10255">
              <TextInput value={form.customerReferenceNumber} onChange={set('customerReferenceNumber')} error={errors.customerReferenceNumber} required placeholder="10255" />
            </Field>
            <Field label="Customer Name" required error={errors.name}>
              <TextInput value={form.name} onChange={set('name')} error={errors.name} required placeholder="Abdul Rouf" />
            </Field>
            <Field label="Contact Number" required error={errors.contactNumber}>
              <TextInput value={form.contactNumber} onChange={set('contactNumber')} error={errors.contactNumber} required placeholder="0333-4458420" />
            </Field>
            <Field label="Type" required error={errors.type} hint="PUM / PMB / COR">
              <Select value={form.type} onChange={set('type')} error={errors.type} required>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Connected From (POP)" required error={errors.connectedFrom}>
              <TextInput value={form.connectedFrom} onChange={set('connectedFrom')} error={errors.connectedFrom} required placeholder="Gajjumata Pop" />
            </Field>
            <Field label="Location (Google Maps URL)" error={errors.location} hint="Shown on the generated ticket">
              <TextInput value={form.location} onChange={set('location')} error={errors.location} placeholder="https://maps.app.goo.gl/…" />
            </Field>
            <Field label="Address" required error={errors.address} full hint="Internal only — never printed on a generated ticket">
              <TextInput value={form.address} onChange={set('address')} error={errors.address} required placeholder="House 22, Shahid Town, Gajjumata, Lahore" />
            </Field>
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend>Network information (internal)</legend>
          <Alert tone="info">
            These fields are searchable and visible here, but are never shown on a generated ticket.
          </Alert>
          <div className="form-grid">
            <Field label="Source Port" error={errors.sourcePort}>
              <TextInput value={form.sourcePort} onChange={set('sourcePort')} error={errors.sourcePort} placeholder="GPON0/1/3" />
            </Field>
            <Field label="Destination Port" error={errors.destinationPort}>
              <TextInput value={form.destinationPort} onChange={set('destinationPort')} error={errors.destinationPort} placeholder="GE0/0/1" />
            </Field>
            <Field label="VLAN" error={errors.vlan}>
              <TextInput value={form.vlan} onChange={set('vlan')} error={errors.vlan} placeholder="613" />
            </Field>
            <Field label="Notes" error={errors.notes} full>
              <Textarea value={form.notes} onChange={set('notes')} error={errors.notes} rows={2} placeholder="Anything the NOC should know about this link…" />
            </Field>
          </div>
        </fieldset>

        {/* Allows Enter-to-submit from any input. */}
        <button type="submit" hidden aria-hidden="true" />
      </form>
    </Modal>
  );
}

function pick(customer) {
  const out = {};
  for (const key of Object.keys(BLANK)) out[key] = customer[key] ?? '';
  return out;
}
