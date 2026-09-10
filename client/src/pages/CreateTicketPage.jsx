import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import TicketPreview from '../components/TicketPreview.jsx';
import { Alert, Badge, DefItem, Field, Select, TextInput, Textarea } from '../components/ui.jsx';
import { PRIORITY_TONE } from '../utils/format.js';

const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
const STATUSES = ['New', 'In Progress'];

/**
 * Select a customer, enter the issue, and the standardized ticket is generated
 * server-side. The panel on the right previews the exact format the operator
 * will get, using the customer's ticket-visible fields only.
 */
export default function CreateTicketPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, serverNow } = useAuth();
  const [params] = useSearchParams();

  const [meta, setMeta] = useState(null);
  const [teams, setTeams] = useState([]);
  const [aiStatus, setAiStatus] = useState(null);

  const [customerQuery, setCustomerQuery] = useState(params.get('customer') || '');
  const [customerResults, setCustomerResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [showResults, setShowResults] = useState(false);
  const lookupRef = useRef(null);

  const [form, setForm] = useState({
    issueType: 'Fiber Cut',
    remarks: '',
    priority: 'Urgent',
    status: 'New',
    ettrMinutes: 60,
    assignedTo: '',
    runAiAnalysis: true,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/meta'), api.get('/field-teams'), api.get('/ai/status')])
      .then(([metaRes, teamRes, aiRes]) => {
        setMeta(metaRes.data);
        setTeams(teamRes.data.items);
        setAiStatus(aiRes.data);
        if (metaRes.data.issueTypes.length) {
          setForm((f) => ({ ...f, issueType: metaRes.data.issueTypes[0].name }));
        }
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  /** Pre-select the customer when arriving from a customer page. */
  const selectCustomer = useCallback(async (reference) => {
    setLookupError('');
    try {
      const { data } = await api.get(`/customers/${reference}`);
      setCustomer(data.customer);
      setCustomerQuery(data.customer.customerReferenceNumber);
      setShowResults(false);
    } catch (err) {
      setLookupError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    const preset = params.get('customer');
    if (preset) selectCustomer(preset);
  }, [params, selectCustomer]);

  useEffect(() => {
    const term = customerQuery.trim();
    if (!term || (customer && term === customer.customerReferenceNumber)) {
      setCustomerResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/customers', { params: { q: term, limit: 8 } });
        setCustomerResults(data.items);
      } catch {
        setCustomerResults([]);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [customerQuery, customer]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (lookupRef.current && !lookupRef.current.contains(event.target)) setShowResults(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  /** Client-side mirror of the server template, for preview only. */
  const previewText = useMemo(() => {
    if (!customer) return '';
    const assignee = teams.find((t) => t._id === form.assignedTo);
    return buildPreview({
      customer,
      form,
      assigneeName: assignee?.name || '',
      assignedByName: user.name,
      now: serverNow(),
    });
  }, [customer, form, teams, user.name, serverNow]);

  const previewEttrAt = useMemo(
    () => new Date(serverNow().getTime() + Number(form.ettrMinutes || 0) * 60000),
    [form.ettrMinutes, serverNow],
  );

  const submit = async (event) => {
    event.preventDefault();
    if (!customer) {
      setLookupError('Select a customer before creating the ticket');
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const { data } = await api.post('/tickets', {
        ...form,
        ettrMinutes: Number(form.ettrMinutes),
        customerId: customer.customerReferenceNumber,
        assignedTo: form.assignedTo || undefined,
      });
      toast.success(`Ticket TID ${data.ticket.ticketNumber} created`, `${customer.name} · ${form.issueType}`);
      if (data.ai && !data.ai.available && form.runAiAnalysis) {
        toast.info('AI analysis skipped', data.ai.reason);
      }
      navigate(`/tickets/${data.ticket.ticketNumber}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      toast.error('Could not create the ticket', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const issueTypes = meta?.issueTypes ?? [];
  const ettrPresets = meta?.ettrPresets ?? [{ label: '1 Hour', minutes: 60 }];

  return (
    <>
      <PageHead back="/tickets" title="Create ticket" subtitle="The standardized ticket is generated automatically from customer master data." />

      {error ? <Alert tone="error" title="Could not create the ticket">{error}</Alert> : null}

      <form onSubmit={submit}>
        <div className="grid grid--detail">
          <div className="stack">
            <div className="card">
              <div className="card__head"><h2>1 · Select customer</h2></div>
              <div className="card__body">
                <div ref={lookupRef} style={{ position: 'relative' }}>
                  <Field label="Customer ID, name or contact" required error={lookupError} hint="Search by reference number, name, contact, VLAN or port.">
                    <TextInput
                      value={customerQuery}
                      error={lookupError}
                      placeholder="10255 or Abdul Rouf"
                      onChange={(event) => { setCustomerQuery(event.target.value); setCustomer(null); setShowResults(true); }}
                      onFocus={() => setShowResults(true)}
                      autoComplete="off"
                    />
                  </Field>

                  {showResults && customerResults.length > 0 ? (
                    <div className="gsearch__panel">
                      {customerResults.map((c) => (
                        <button
                          type="button"
                          key={c._id}
                          className="gsearch__item"
                          style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: 'pointer' }}
                          onClick={() => { setCustomer(c); setCustomerQuery(c.customerReferenceNumber); setShowResults(false); setLookupError(''); }}
                        >
                          <div className="gsearch__item-title">{c.customerReferenceNumber} — {c.name}</div>
                          <div className="gsearch__item-sub">{c.type} · {c.connectedFrom} · {c.contactNumber}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {customer ? (
                  <div style={{ marginTop: 6 }}>
                    <Alert tone="ok" title="Customer selected">
                      Fields below are auto-filled from the master record.
                    </Alert>
                    <div className="deflist">
                      <DefItem label="Customer ID" value={customer.customerReferenceNumber} mono />
                      <DefItem label="Name" value={customer.name} />
                      <DefItem label="Contact" value={customer.contactNumber} mono />
                      <DefItem label="Connected From" value={customer.connectedFrom} />
                      <DefItem label="Location">
                        {customer.location ? <a href={customer.location} target="_blank" rel="noreferrer">Maps ↗</a> : <span className="muted">—</span>}
                      </DefItem>
                      <DefItem label="Type (internal)"><Badge tone="outline">{customer.type}</Badge></DefItem>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card__head"><h2>2 · Issue details</h2></div>
              <div className="card__body">
                <div className="form-grid">
                  <Field label="Issue Type" required error={errors.issueType}>
                    <Select value={form.issueType} onChange={set('issueType')} error={errors.issueType} required>
                      {issueTypes.map((t) => <option key={t._id} value={t.name}>{t.name}</option>)}
                    </Select>
                  </Field>

                  <Field label="Required / Priority" required error={errors.priority}>
                    <Select value={form.priority} onChange={set('priority')} error={errors.priority}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </Field>

                  <Field label="ETTR" required error={errors.ettrMinutes} hint="ETTR is calculated from server time when the ticket is saved.">
                    <Select value={String(form.ettrMinutes)} onChange={set('ettrMinutes')} error={errors.ettrMinutes}>
                      {ettrPresets.map((preset) => (
                        <option key={preset.minutes} value={preset.minutes}>{preset.label}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Initial status" error={errors.status}>
                    <Select value={form.status} onChange={set('status')} error={errors.status}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Field>

                  <Field label="Assign To (field team / member)" error={errors.assignedTo} full>
                    <Select value={form.assignedTo} onChange={set('assignedTo')} error={errors.assignedTo}>
                      <option value="">Assign later</option>
                      <optgroup label="Teams">
                        {teams.filter((t) => t.kind === 'team').map((t) => (
                          <option key={t._id} value={t._id}>{t.name}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Members">
                        {teams.filter((t) => t.kind === 'member').map((t) => (
                          <option key={t._id} value={t._id}>{t.name}{t.area ? ` — ${t.area}` : ''} ({t.openTickets} open)</option>
                        ))}
                      </optgroup>
                    </Select>
                  </Field>

                  <Field label="Remarks" error={errors.remarks} full hint="What the NOC operator observed — appears on the generated ticket.">
                    <Textarea value={form.remarks} onChange={set('remarks')} error={errors.remarks} rows={3} placeholder="shahid town fiber down" />
                  </Field>
                </div>

                <label className="checkbox" style={{ marginTop: 4 }}>
                  <input type="checkbox" checked={form.runAiAnalysis} onChange={set('runAiAnalysis')} />
                  Run AI analysis after creating (never blocks ticket creation)
                </label>
                {aiStatus && !aiStatus.available ? (
                  <div className="field__hint">AI is currently <strong>{aiStatus.status}</strong> — {aiStatus.reason}</div>
                ) : null}
              </div>
              <div className="card__foot">
                <div className="row row--end">
                  <button type="button" className="btn btn--secondary" onClick={() => navigate('/tickets')} disabled={busy}>
                    Cancel
                  </button>
                  <button className="btn" type="submit" disabled={busy || !customer}>
                    {busy ? <span className="spinner" /> : null}
                    Generate Ticket
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Live preview</h2>
              <div className="card__head-actions">
                <Badge tone={PRIORITY_TONE[form.priority]}>{form.priority}</Badge>
              </div>
            </div>
            <div className="card__body">
              {customer ? (
                <>
                  <TicketPreview text={previewText} ettrAt={previewEttrAt} live />
                  <Alert tone="info" title="Visibility check">
                    Address, {customer.type} type, ports and VLAN are deliberately absent from this ticket.
                  </Alert>
                  <div className="small muted">
                    TID is assigned by the server when you press <strong>Generate Ticket</strong>.
                  </div>
                </>
              ) : (
                <div className="muted small">Select a customer to preview the generated ticket.</div>
              )}
            </div>
          </div>
        </div>
      </form>
    </>
  );
}

const PRIORITY_LABELS = {
  Urgent: 'Urgent (Do First)',
  High: 'High (Do Next)',
  Medium: 'Medium (Normal)',
  Low: 'Low (When Free)',
};
const PRIORITY_MESSAGES = {
  Urgent: "Resolve this ticket as soon as possible, it's Urgent",
  High: 'Please prioritize this ticket and share an update shortly',
  Medium: 'Please resolve this ticket within the given ETTR',
  Low: 'Please handle this ticket as per your availability',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stamp(date) {
  const hours24 = date.getHours();
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return (
    `${String(date.getDate()).padStart(2, '0')}-${MONTHS[date.getMonth()]} ` +
    `${String(hour12).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} ` +
    `${hours24 < 12 ? 'AM' : 'PM'}`
  );
}

/**
 * Preview-only mirror of the server's ticket template.
 * Builds from the ticket-visible customer fields exclusively.
 */
function buildPreview({ customer, form, assigneeName, assignedByName, now }) {
  const minutes = Number(form.ettrMinutes) || 60;
  const ettrAt = new Date(now.getTime() + minutes * 60000);
  const sep = '-'.repeat(30);
  const lines = [
    `*TID: (assigned on save)* | ${stamp(now)}`,
    `ETTR: ${stamp(ettrAt)} {${Math.floor(minutes / 60)}H ${minutes % 60}M}`,
    `Time Left: *{0:Days 0:Hours 0:Mins }*`,
    sep,
    `Site | Customer ID: ${customer.customerReferenceNumber}`,
    `Name: ${customer.name}`,
    ...(customer.location ? [`Location: ${customer.location}`] : []),
    `Contact #: ${customer.contactNumber}`,
    `Connected From: ${customer.connectedFrom}`,
    sep,
    `Type: *${form.issueType}*`,
    `Remarks: ${form.remarks || '-'}`,
    sep,
    `Assigned By: ${assignedByName}`,
    `Required: ${PRIORITY_LABELS[form.priority]}`,
    `Status: ${form.status}`,
    ...(assigneeName ? [`*${assigneeName}:* ${PRIORITY_MESSAGES[form.priority]}`] : []),
  ];
  return lines.join('\n');
}
