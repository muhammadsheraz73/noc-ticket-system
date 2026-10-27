import { useEffect, useState } from 'react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, DefItem, Field, TextInput, Textarea } from '../components/ui.jsx';
import LogoPicker from '../components/LogoPicker.jsx';
import { ROLE_LABELS, formatDateTime } from '../utils/format.js';
import { blobError, downloadFromApi } from '../utils/download.js';

export default function SettingsPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [meta, setMeta] = useState(null);
  const [ai, setAi] = useState(null);
  const [health, setHealth] = useState(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/meta').then(({ data }) => setMeta(data)).catch(() => {});
    // The AI assistant only helps with tickets, which the billing panel does not have.
    if (user.role !== ROLES.ACCOUNTS) api.get('/ai/status').then(({ data }) => setAi(data)).catch(() => {});
    api.get('/health').then(({ data }) => setHealth(data)).catch(() => {});
  }, [user.role]);

  const changePassword = async (event) => {
    event.preventDefault();
    setErrors({});

    if (next !== confirm) {
      setErrors({ confirm: 'The two passwords do not match' });
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password updated', 'Use the new password next time you sign in.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not change the password', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Settings" subtitle="Your account, and how this system is configured." />

      {isAdmin ? <CompanyProfileCard /> : null}
      {isAdmin ? <DataExportCard /> : null}

      <div className="grid grid--2">
        <div className="card">
          <div className="card__head"><h2>My account</h2></div>
          <div className="card__body">
            <div className="deflist">
              <DefItem label="Name" value={user.name} />
              <DefItem label="Email" value={user.email} mono />
              <DefItem label="Role"><Badge tone="info">{ROLE_LABELS[user.role]}</Badge></DefItem>
              <DefItem label="Phone" value={user.phone} />
              <DefItem label="Last sign-in" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'first session'} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2>Change password</h2></div>
          <div className="card__body">
            <form onSubmit={changePassword}>
              <Field label="Current password" required error={errors.currentPassword}>
                <TextInput type="password" value={current} autoComplete="current-password" required
                  onChange={(event) => setCurrent(event.target.value)} error={errors.currentPassword} />
              </Field>
              <Field label="New password" required error={errors.newPassword} hint="At least 8 characters.">
                <TextInput type="password" value={next} autoComplete="new-password" required minLength={8}
                  onChange={(event) => setNext(event.target.value)} error={errors.newPassword} />
              </Field>
              <Field label="Confirm new password" required error={errors.confirm}>
                <TextInput type="password" value={confirm} autoComplete="new-password" required
                  onChange={(event) => setConfirm(event.target.value)} error={errors.confirm} />
              </Field>
              <button className="btn" type="submit" disabled={busy || !current || !next}>
                {busy ? <span className="spinner" /> : null} Update password
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2>System configuration</h2></div>
          <div className="card__body">
            <div className="deflist">
              <DefItem label="API status">
                <Badge tone={health ? 'ok' : 'danger'}>{health ? 'Online' : 'Unreachable'}</Badge>
              </DefItem>
              <DefItem label="Version" value={health?.version} />
              <DefItem label="Operational timezone" value={meta?.timezone} />
              <DefItem label="Server time" value={meta ? formatDateTime(meta.serverTime) : ''} />
              <DefItem label="Invoice currency" value={meta?.currency} />
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              Ticket times, ETTR and Time Left are all calculated in the operational timezone using server time.
            </div>
          </div>
        </div>

        {user.role !== ROLES.ACCOUNTS ? (
          <div className="card">
            <div className="card__head">
              <h2>AI assistant</h2>
              <div className="card__head-actions">
                <Badge tone={ai?.available ? 'ok' : 'neutral'}>{ai?.status ?? '…'}</Badge>
              </div>
            </div>
            <div className="card__body">
              {ai?.available ? (
                <>
                  <Alert tone="ok" title="AI is configured">
                    Model: <code>{ai.model}</code>{ai.provider ? ` (via ${ai.provider})` : ''}
                  </Alert>
                  <div className="small muted">
                    AI suggests an issue category, priority, summary, troubleshooting steps and a customer response.
                    It never blocks ticket creation and every suggestion can be overridden.
                  </div>
                </>
              ) : (
                <>
                  <Alert tone="info" title="AI is not active">{ai?.reason || 'Checking…'}</Alert>
                  <div className="small muted">
                    Set <code>OPENROUTER_API_KEY</code> in <code>server/.env</code> and restart the API to enable it.
                    A free key from <code>openrouter.ai/keys</code> is enough — the default model costs nothing.
                    The key stays on the server and is never sent to the browser.
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {isAdmin && meta ? (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card__head"><h2>Issue types</h2></div>
            <div className="card__body card__body--flush">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Default ETTR</th><th>Description</th><th>Status</th></tr></thead>
                  <tbody>
                    {meta.issueTypes.map((type) => (
                      <tr key={type._id}>
                        <td className="strong">{type.name}</td>
                        <td className="num">{type.defaultEttrMinutes} min</td>
                        <td className="small">{type.description || '—'}</td>
                        <td><Badge tone={type.isActive ? 'ok' : 'neutral'}>{type.isActive ? 'Active' : 'Inactive'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

const BLANK_COMPANY = { contactName: '', phone: '', email: '', address: '', website: '', tagline: '', logo: '', quotationTerms: '', bankAccounts: [] };
const BLANK_ACCOUNT = { title: '', bank: '', accountNumber: '', iban: '' };
const MAX_ACCOUNTS = 4;

/** The client's letterhead — printed on every quotation it downloads. */
/** Client admins can take a full copy of their own data at any time. */
function DataExportCard() {
  const toast = useToast();
  const [busy, setBusy] = useState('');

  /** kind: 'excel' or 'pdf' — the same complete data either way. */
  const download = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'pdf') await downloadFromApi('/company/export/pdf', 'all-data.pdf');
      else await downloadFromApi('/company/export', 'all-data.xlsx');
      toast.success('Download ready', `Your data has been saved as ${kind === 'pdf' ? 'a PDF' : 'an Excel'} file.`);
    } catch (err) {
      toast.error('Could not download your data', await blobError(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head"><h2>Your data</h2></div>
      <div className="card__body row" style={{ justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div className="small muted" style={{ maxWidth: 640 }}>
          Your data belongs to you. Download everything — customers, tickets, invoices, quotations, monthly
          bills, payments, employees, stock and network — with every detail. Excel has one sheet per area;
          the PDF lists every record with all its fields, ready to print. Nothing is changed.
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--excel" onClick={() => download('excel')} disabled={Boolean(busy)}>
            {busy === 'excel' ? <span className="spinner" /> : '⭳'} Download Excel
          </button>
          <button className="btn" onClick={() => download('pdf')} disabled={Boolean(busy)}>
            {busy === 'pdf' ? <span className="spinner" /> : '⭳'} Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyProfileCard() {
  const toast = useToast();
  const [company, setCompany] = useState(null);
  const [form, setForm] = useState(BLANK_COMPANY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api.get('/company')
      .then(({ data }) => {
        setCompany(data.company);
        setForm(Object.fromEntries(Object.keys(BLANK_COMPANY).map((k) => [k, data.company[k] ?? BLANK_COMPANY[k]])));
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const setAccount = (index, key) => (event) => setForm((f) => ({
    ...f,
    bankAccounts: f.bankAccounts.map((a, i) => (i === index ? { ...a, [key]: event.target.value } : a)),
  }));
  const addAccount = () => setForm((f) => ({ ...f, bankAccounts: [...f.bankAccounts, { ...BLANK_ACCOUNT }] }));
  const removeAccount = (index) => setForm((f) => ({ ...f, bankAccounts: f.bankAccounts.filter((_, i) => i !== index) }));

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      // Rows left completely blank are dropped rather than rejected.
      const bankAccounts = form.bankAccounts.filter((a) => Object.values(a).some((v) => String(v).trim()));
      const { data } = await api.put('/company', { ...form, bankAccounts });
      setForm((f) => ({ ...f, bankAccounts: data.company.bankAccounts || [] }));
      setCompany(data.company);
      toast.success('Company profile saved', 'Quotations and invoices will use these details.');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error('Could not save the company profile', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2>Company profile</h2>
        <span className="small muted">Name, contact, address and bank details printed on your quotations and invoices</span>
      </div>
      <div className="card__body">
        {loadError ? <Alert tone="error">{loadError}</Alert> : null}
        {!company && !loadError ? <div className="muted small">Loading…</div> : null}
        {company ? (
          <form onSubmit={save}>
            <div className="form-grid">
              <Field label="Company logo" full error={errors.logo}>
                <LogoPicker value={form.logo} onChange={(logo) => setForm((f) => ({ ...f, logo }))} error={errors.logo} />
              </Field>
              <Field label="Company name" hint="Set by your panel provider.">
                <TextInput value={company.name} disabled />
              </Field>
              <Field label="Contact person" error={errors.contactName}>
                <TextInput value={form.contactName} onChange={set('contactName')} error={errors.contactName} />
              </Field>
              <Field label="Phone" error={errors.phone}>
                <TextInput value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="042-37888999" />
              </Field>
              <Field label="Email" error={errors.email}>
                <TextInput type="email" value={form.email} onChange={set('email')} error={errors.email} placeholder="info@yourcompany.pk" />
              </Field>
              <Field label="Address" error={errors.address}>
                <TextInput value={form.address} onChange={set('address')} error={errors.address} placeholder="Office 4, Ferozepur Road, Lahore" />
              </Field>
              <Field label="Website" error={errors.website}>
                <TextInput value={form.website} onChange={set('website')} error={errors.website} placeholder="www.yourcompany.pk" />
              </Field>
              <Field label="Tagline" error={errors.tagline} hint="Printed in the coloured band on invoices. Left empty, your company name is used.">
                <TextInput value={form.tagline} onChange={set('tagline')} error={errors.tagline} placeholder="Reliable source of internet connectivity" />
              </Field>
              <Field label="Default quotation terms" full error={errors.quotationTerms} hint="One per line. Filled into every new quotation; you can still change them per quotation. Left empty, the two terms shown in grey are used.">
                <Textarea rows={4} value={form.quotationTerms} onChange={set('quotationTerms')} error={errors.quotationTerms}
                  placeholder={'50% advance with the purchase order\nInstallation within 3 working days of payment'} />
              </Field>
            </div>

            <div className="bank-editor">
              <div className="bank-editor__head">
                <div>
                  <div className="strong">Bank accounts</div>
                  <div className="small muted">Printed under "Bank details" on every quotation and invoice.</div>
                </div>
                {form.bankAccounts.length < MAX_ACCOUNTS ? (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={addAccount}>＋ Add bank account</button>
                ) : null}
              </div>
              {errors.bankAccounts ? <div className="field__error">{errors.bankAccounts}</div> : null}
              {form.bankAccounts.length === 0 ? (
                <div className="small muted">No bank accounts yet.</div>
              ) : form.bankAccounts.map((account, i) => (
                <div className="bank-editor__row" key={i}>
                  <div className="bank-editor__num">{i + 1}</div>
                  <div className="form-grid" style={{ flex: 1 }}>
                    <Field label="Account title" required>
                      <TextInput value={account.title} onChange={setAccount(i, 'title')} placeholder="TARIQ ALI" />
                    </Field>
                    <Field label="Bank">
                      <TextInput value={account.bank} onChange={setAccount(i, 'bank')} placeholder="MCB Bank" />
                    </Field>
                    <Field label="Account number">
                      <TextInput value={account.accountNumber} onChange={setAccount(i, 'accountNumber')} />
                    </Field>
                    <Field label="IBAN">
                      <TextInput value={account.iban} onChange={setAccount(i, 'iban')} placeholder="PK00XXXX0000000000000000" />
                    </Field>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => removeAccount(i)} aria-label={`Remove account ${i + 1}`}>✕</button>
                </div>
              ))}
            </div>

            <button className="btn" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : null} Save company profile
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
