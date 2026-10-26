import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, DefItem, EmptyState, Field, Modal, Select, Stat, TableSkeleton, TextInput,
} from '../components/ui.jsx';
import { formatDateTime, formatMoney } from '../utils/format.js';

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

  const t = state.totals;
  return (
    <>
      {state.error ? <Alert tone="error" title="Billing error">{state.error}</Alert> : null}
      {info ? <Alert tone="success" title="Done">{info}</Alert> : null}

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
          <button className="btn btn--sm" onClick={generate} disabled={busy}>
            ＋ Generate ALL BILLS
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
          setInfo(`${created ? 'Bill created' : 'Bill updated'}: ${record.username}, ${record.period}, ${formatMoney(record.fee)}.`);
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
