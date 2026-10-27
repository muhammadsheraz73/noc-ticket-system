import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, DefItem, EmptyState, Field, Modal, Select, Stat, TableSkeleton, TextInput,
} from '../components/ui.jsx';
import { formatDateTime, formatMoney } from '../utils/format.js';
import PdfPreview from '../components/PdfPreview.jsx';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const monthStr = () => todayStr().slice(0, 7);
const STATUS_TONE = { Received: 'ok', Partial: 'warn', Pending: 'danger' };

/** A date picked in the UI becomes "now" when it is today, otherwise midday of that day. */
const toIso = (day) => (day === todayStr() ? new Date().toISOString() : new Date(`${day}T12:00:00`).toISOString());

export default function BillingPage() {
  return (
    <>
      <PageHead
        title="Billing"
        subtitle="Monthly bills, payments received — replaces the Excel sheet."
      />
      <div className="stack">
        <MonthlyBills />
      </div>
    </>
  );
}

/* ------------------------------ Monthly bills ------------------------------ */

function MonthlyBills() {
  const { user } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(monthStr());
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ items: [], totals: null, loading: true, error: '' });
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [picking, setPicking] = useState(false);
  const [billing, setBilling] = useState(null);
  const [deleting, setDeleting] = useState(null);
  /** The bill whose slip is open in the preview. */
  const [slip, setSlip] = useState(null);
  const [slipsBusy, setSlipsBusy] = useState(false);
  /** After "Generate ALL BILLS", offer the month's slips in the success message. */
  const [offerSlips, setOfferSlips] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/billing/records', {
        params: { period, status: status || undefined, q: query || undefined, limit: 500 },
      });
      setState({ items: data.items, totals: data.totals, loading: false, error: '' });
    } catch (error) {
      setState({ items: [], totals: null, loading: false, error: errorMessage(error) });
    }
  }, [period, status, query]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/billing/records/generate', { period });
      setInfo(`${data.created} new bills created for ${period} (${data.alreadyExisting} already existed).`);
      setOfferSlips(data.created + data.alreadyExisting > 0);
      await load();
    } catch (error) {
      setState((s) => ({ ...s, error: errorMessage(error) }));
    } finally {
      setBusy(false);
    }
  };

  const removeBill = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/billing/records/${deleting._id}`);
      toast.success('Bill deleted', data.message);
      setDeleting(null);
      await load();
    } catch (error) {
      toast.error('Could not delete the bill', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const response = await api.get('/billing/export', { params: { period }, responseType: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(response.data);
    link.download = `billing-${period}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  /** Every slip of the month (respecting the status filter) in one PDF, one bill per page. */
  const downloadSlips = async () => {
    setSlipsBusy(true);
    try {
      const response = await api.get('/billing/slips', {
        params: { period, status: status || undefined, download: true },
        responseType: 'blob',
      });
      savePdf(new Uint8Array(await response.data.arrayBuffer()), `Bills ${period}${status ? ` (${status})` : ''}.pdf`);
    } catch (error) {
      toast.error('Could not download the slips', await blobErrorMessage(error));
    } finally {
      setSlipsBusy(false);
    }
  };

  const t = state.totals;
  return (
    <>
      {state.error ? <Alert tone="error" title="Billing error">{state.error}</Alert> : null}
      {info ? (
        <Alert tone="success" title="Done">
          {info}
          {offerSlips ? (
            <button className="btn btn--sm" style={{ marginLeft: 12 }} onClick={downloadSlips} disabled={slipsBusy}>
              {slipsBusy ? <span className="spinner" /> : '⭳'} Download all slips
            </button>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid grid--stats grid--stats-3">
        <Stat label="Total Billed" value={formatMoney(t?.fee || 0)} hint={`${t?.count || 0} bills`} />
        <Stat label="Received" value={formatMoney(t?.received || 0)} hint={`${t?.byStatus?.Received || 0} paid`} tone="ok" />
        <Stat label="Arrears" value={formatMoney(t?.arrears || 0)} hint={`${(t?.byStatus?.Pending || 0) + (t?.byStatus?.Partial || 0)} unpaid`} tone="danger" />
      </div>

      <div className="card">
        <div className="filters">
          <div className="filters__item">
            <Field label="Month">
              <TextInput type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
            </Field>
          </div>
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput placeholder="User, address, package…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="Pending">Pending</option>
                <option value="Partial">Partial</option>
                <option value="Received">Received</option>
              </Select>
            </Field>
          </div>
          <button className="btn btn--secondary btn--sm" onClick={() => setPicking(true)}>
            ＋ New bill
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => setImporting(true)} title="Load an existing Excel billing sheet">
            ⭱ Import Excel
          </button>
          <button className="btn btn--sm" onClick={generate} disabled={busy}>
            ＋ Generate ALL BILLS
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={downloadSlips}
            disabled={slipsBusy || state.items.length === 0}
            title="Every bill slip of this month in one PDF"
          >
            {slipsBusy ? <span className="spinner spinner--dark" /> : '⭳'} Slips
          </button>
          <button className="btn btn--excel btn--sm" onClick={download}>⭳ Excel</button>
        </div>

        <div className="card__body card__body--flush">
          {state.loading ? (
            <TableSkeleton rows={8} cols={8} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="No bills for this month"
              message='Press "New bill" to bill a customer, or "Generate ALL BILLS" to bill everyone billed before.'
            />
          ) : (
            <div className="table-wrap">
              <table className="table table--even">
                <thead>
                  <tr>
                    <th>User</th><th>Unit</th><th>Address</th><th className="text-right">Fee</th>
                    <th>Status</th><th className="text-right">Received</th><th className="text-right">Arrears</th>
                    <th>Rec. By</th><th>Date</th><th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((r) => (
                    <tr key={r._id}>
                      <td className="strong">{r.username}</td>
                      <td className="small">{r.package}</td>
                      <td className="small">{r.address}</td>
                      <td className="text-right num">{formatMoney(r.fee)}</td>
                      <td><Badge tone={STATUS_TONE[r.paymentStatus]}>{r.paymentStatus}</Badge></td>
                      <td className="text-right num">{formatMoney(r.received)}</td>
                      <td className="text-right num">{r.arrears ? formatMoney(r.arrears) : '–'}</td>
                      <td className="small">{r.lastReceivedBy}</td>
                      <td className="small">{r.lastReceivedAt ? formatDateTime(r.lastReceivedAt) : ''}</td>
                      <td className="nowrap">
                        <div className="row-actions">
                          <button className="btn btn--sm" onClick={() => setPaying(r)}>
                            {r.paymentStatus === 'Received' ? 'Details' : 'Receive'}
                          </button>
                          <button className="btn btn--secondary btn--sm" onClick={() => setSlip(r)}>
                            Slip
                          </button>
                          <button className="btn btn--secondary btn--sm btn--delete" onClick={() => setDeleting(r)}>
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

      <PaymentModal
        record={paying}
        defaultReceiver={user?.name || ''}
        onClose={() => setPaying(null)}
        onChanged={async (record) => { setPaying(record); await load(); }}
      />

      <CustomerPickerModal
        open={picking}
        period={period}
        onClose={() => setPicking(false)}
        onPick={(customer) => { setPicking(false); setBilling(customer); }}
      />

      <CustomerBillModal
        customer={billing}
        period={period}
        onClose={() => setBilling(null)}
        onSaved={async (created, record) => {
          setBilling(null);
          setOfferSlips(false);
          setInfo(`${created ? 'Bill created' : 'Bill updated'}: ${record.username}, ${record.period}, ${formatMoney(record.fee)}.`);
          await load();
          // The slip is generated with the bill: show it straight away, ready to download.
          setSlip(record);
        }}
      />

      <BillSlipModal record={slip} onClose={() => setSlip(null)} />

      <ImportBillsModal
        open={importing}
        defaultPeriod={period}
        onClose={() => setImporting(false)}
        onImported={async (result) => {
          setImporting(false);
          setPeriod(result.period);
          setOfferSlips(result.billsCreated > 0);
          setInfo(`Imported ${result.rows} rows for ${result.period}: ${result.created} new users, ${result.updated} updated, ${result.billsCreated} bills, ${result.paymentsAdded} payments.`);
          await load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this bill?"
        message={deleting
          ? `${deleting.username}'s bill for ${deleting.period} (${formatMoney(deleting.fee)})${deleting.payments?.length ? ` and its ${deleting.payments.length} payment(s)` : ''} will be deleted. This cannot be undone.`
          : ''}
        confirmLabel="Delete bill"
        tone="danger"
        busy={busy}
        onConfirm={removeBill}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

/** Search the customer list and pick who to bill for the month. */
function CustomerPickerModal({ open, period, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ items: [], loading: false, error: '' });

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const { data } = await api.get('/billing/customers', { params: { period, q: query || undefined, limit: 20 } });
        setState({ items: data.items, loading: false, error: '' });
      } catch (e) {
        setState({ items: [], loading: false, error: errorMessage(e) });
      }
    }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [open, period, query]);

  useEffect(() => { if (!open) setQuery(''); }, [open]);

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title={`New bill — ${period}`}>
      <Field label="Customer">
        <TextInput
          placeholder="Search name, reference, address, contact…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </Field>
      {state.error ? <Alert tone="error" title="Error">{state.error}</Alert> : null}
      {state.loading && !state.items.length ? (
        <TableSkeleton rows={4} cols={3} />
      ) : state.items.length === 0 ? (
        <EmptyState icon="👥" title="No customers found" message="Add the customer in the Customers module first." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {state.items.map((c) => (
                <tr key={c._id}>
                  <td>
                    <div className="strong">{c.name}</div>
                    <div className="small muted">{c.customerReferenceNumber}{c.bandwidth ? ` · ${c.bandwidth}` : ''}</div>
                  </td>
                  <td className="text-right num small">{c.monthlyFee ? formatMoney(c.monthlyFee) : ''}</td>
                  <td className="text-right">
                    <button className={`btn btn--sm${c.bill ? ' btn--secondary' : ''}`} onClick={() => onPick(c)}>
                      {c.bill ? 'Update bill' : 'Bill'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function PaymentModal({ record, defaultReceiver, onClose, onChanged }) {
  const [amount, setAmount] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [day, setDay] = useState(todayStr());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!record) return;
    setAmount(record.arrears > 0 ? String(record.arrears) : '');
    setReceivedBy(defaultReceiver);
    setDay(todayStr());
    setError('');
  }, [record?._id, record?.arrears, defaultReceiver]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!record) return null;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/billing/records/${record._id}/payments`, {
        amount: Number(amount), receivedBy, receivedAt: toIso(day),
      });
      await onChanged(data.record);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removePayment = async (paymentId) => {
    if (!window.confirm('Delete this payment?')) return;
    try {
      const { data } = await api.delete(`/billing/records/${record._id}/payments/${paymentId}`);
      await onChanged(data.record);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${record.username} — ${record.period}`}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>Close</button>
          <button className="btn" onClick={save} disabled={busy || !Number(amount)}>Save payment</button>
        </>
      }
    >
      {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
      <p className="small muted">
        Fee {formatMoney(record.fee)} · Received {formatMoney(record.received)} · Arrears {formatMoney(record.arrears)}
      </p>
      <Field label="Amount received">
        <TextInput type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="Received by">
        <TextInput value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
      </Field>
      <Field label="Date">
        <TextInput type="date" value={day} max={todayStr()} onChange={(e) => setDay(e.target.value)} />
      </Field>
      {record.payments?.length ? (
        <>
          <h4>Payments</h4>
          <table className="table">
            <tbody>
              {record.payments.map((p) => (
                <tr key={p._id}>
                  <td className="nowrap small">{formatDateTime(p.receivedAt)}</td>
                  <td className="num">{formatMoney(p.amount)}</td>
                  <td className="small">{p.receivedBy}</td>
                  <td><button className="btn btn--ghost btn--sm" onClick={() => removePayment(p._id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Modal>
  );
}

function CustomerBillModal({ customer, period, onClose, onSaved }) {
  const [fee, setFee] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customer) return;
    // This month's bill wins, then the fee on the billing list; otherwise it is typed in.
    const known = customer.bill?.fee || customer.monthlyFee;
    setFee(known ? String(known) : '');
    setError('');
  }, [customer]);

  if (!customer) return null;

  const source = customer.bill
    ? `This month's bill already exists (${customer.bill.paymentStatus}). Saving overwrites its fee.`
    : customer.monthlyFee
      ? 'Fee fetched from the billing list. Change it if needed.'
      : 'No fee on record for this customer. Enter the monthly fee.';

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/billing/customers/${customer._id}/bill`, { period, fee: Number(fee) });
      await onSaved(data.created, data.record);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${customer.bill ? 'Update' : 'Generate'} monthly bill — ${period}`}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy || !(Number(fee) > 0)}>
            {busy ? 'Saving…' : customer.bill ? 'Update bill' : 'Create bill'}
          </button>
        </>
      }
    >
      {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
      <div className="deflist">
        <DefItem label="Customer" value={customer.name} />
        <DefItem label="Reference" value={customer.customerReferenceNumber} mono />
        <DefItem label="Package" value={customer.bandwidth} />
        <DefItem label="Contact" value={customer.contactNumber} />
        <DefItem label="Address" value={customer.address} />
        <DefItem label="Status" value={customer.status} />
      </div>
      <Field label="Monthly fee (PKR)" required hint={source}>
        <TextInput
          type="number"
          min="1"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && Number(fee) > 0 && !busy) save(); }}
          autoFocus
        />
      </Field>
    </Modal>
  );
}

/* -------------------------------- bill slip -------------------------------- */

/** Save PDF bytes under a readable file name. */
function savePdf(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[\/:*?"<>|]/g, '');
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A failed blob request carries its JSON error as a Blob — read the message out of it. */
async function blobErrorMessage(error) {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message || errorMessage(error);
    } catch {
      return errorMessage(error);
    }
  }
  return errorMessage(error);
}

/** Preview of one bill's slip, exactly as it downloads. */
function BillSlipModal({ record, onClose }) {
  const [bytes, setBytes] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!record) return undefined;
    let cancelled = false;
    setBytes(null);
    setError('');
    api.get(`/billing/records/${record._id}/slip`, { responseType: 'blob' })
      .then(async (res) => { if (!cancelled) setBytes(new Uint8Array(await res.data.arrayBuffer())); })
      .catch(async (err) => { if (!cancelled) setError(await blobErrorMessage(err)); });
    return () => { cancelled = true; };
  }, [record?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!record) return null;

  const filename = `Bill ${record.period} - ${record.username}.pdf`;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Bill slip — ${record.username}, ${record.period}`}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>Close</button>
          <button className="btn" onClick={() => savePdf(bytes, filename)} disabled={!bytes}>⭳ Download slip</button>
        </>
      }
    >
      {error ? <Alert tone="error" title="Could not generate the slip">{error}</Alert> : null}
      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 10 }}>
        <PdfPreview bytes={bytes} loading={!bytes && !error} />
      </div>
    </Modal>
  );
}

/* ------------------------------- Excel import ------------------------------- */

const ACTION_LABEL = { new: 'New user', update: 'Update', unchanged: 'No change' };
const ACTION_TONE = { new: 'ok', update: 'info', unchanged: 'neutral' };

/**
 * Load an ISP's existing Excel billing sheet in two steps: Preview (nothing is
 * saved) and then Import. Empty cells never erase saved details, existing
 * bills are left as they are.
 */
function ImportBillsModal({ open, defaultPeriod, onClose, onImported }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPeriod(defaultPeriod);
    setFile(null);
    setPreview(null);
    setError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const send = async (dryRun) => {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post('/billing/subscribers/import', body, { params: { period, dryRun: dryRun ? 'true' : undefined } });
      if (dryRun) setPreview(data);
      else await onImported(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Import billing sheet from Excel"
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {preview ? (
            <button className="btn" onClick={() => send(false)} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Import {preview.rows} rows
            </button>
          ) : (
            <button className="btn" onClick={() => send(true)} disabled={busy || !file}>
              {busy ? <span className="spinner" /> : null} Preview
            </button>
          )}
        </>
      }
    >
      {error ? <Alert tone="error" title="Could not read the sheet">{error}</Alert> : null}
      {!preview ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            The first sheet needs a <b>USER</b> column. Other columns it understands: <b>DATED</b>, <b>Unit</b> (package),
            <b> Status</b>, <b>ADRESS</b>, <b>Fee</b>, <b>Received</b>, <b>Rec. By</b>. You will see a preview first — nothing is saved until you press Import.
          </p>
          <div className="form-grid">
            <Field label="Bill month" hint="Bills and payments in the sheet are created for this month.">
              <TextInput type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
            </Field>
            <Field label="Excel file" hint=".xlsx, .xls or .csv">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Alert tone="info" title="Preview — nothing has been saved yet">
            {preview.rows} rows for {preview.period}: <b>{preview.created}</b> new users, <b>{preview.updated}</b> updated,
            {' '}<b>{preview.unchanged}</b> unchanged · <b>{preview.billsCreated}</b> new bills
            {preview.billsExisting ? ` (${preview.billsExisting} already billed, left as they are)` : ''} · <b>{preview.paymentsAdded}</b> payments.
            {' '}Empty cells never erase details that are already saved.
          </Alert>
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr><th>User</th><th>Package</th><th className="text-right">Fee</th><th>Status</th><th>User record</th><th>Bill</th><th className="text-right">Payment</th></tr>
              </thead>
              <tbody>
                {preview.preview.map((r) => (
                  <tr key={r.username}>
                    <td className="strong">{r.username}</td>
                    <td className="small">{r.package || '—'}</td>
                    <td className="text-right num">{formatMoney(r.fee)}</td>
                    <td className="small">{r.status}</td>
                    <td><Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge></td>
                    <td className="small">{r.bill === 'new' ? 'New bill' : r.bill === 'exists' ? 'Already billed' : '—'}</td>
                    <td className="text-right num">{r.payment ? formatMoney(r.payment) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows > preview.preview.length ? <p className="small muted">Showing the first {preview.preview.length} of {preview.rows} rows.</p> : null}
          <button type="button" className="link-btn small" onClick={() => setPreview(null)}>← Choose a different file</button>
        </>
      )}
    </Modal>
  );
}
