import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, DefItem, EmptyState, Field, Modal, Pagination, Select, Stat, Tabs, TableSkeleton, TextInput,
} from '../components/ui.jsx';
import { formatDateTime, formatMoney } from '../utils/format.js';

const todayStr = () => new Date().toLocaleDateString('en-CA');
const monthStr = () => todayStr().slice(0, 7);
const STATUS_TONE = { Received: 'ok', Partial: 'warn', Pending: 'danger' };

/** A date picked in the UI becomes "now" when it is today, otherwise midday of that day. */
const toIso = (day) => (day === todayStr() ? new Date().toISOString() : new Date(`${day}T12:00:00`).toISOString());

export default function BillingPage() {
  const [tab, setTab] = useState('bills');
  const [notice, setNotice] = useState('');

  return (
    <>
      <PageHead
        title="Billing"
        subtitle="Monthly bills, payments received — replaces the Excel sheet."
      />
      {notice ? <Alert tone="success" title="Done">{notice}</Alert> : null}
      <Tabs
        tabs={[
          { key: 'bills', label: 'Monthly Bills' },
          { key: 'subscribers', label: 'Users' },
        ]}
        active={tab}
        onChange={(t) => { setTab(t); setNotice(''); }}
      />
      <div className="stack" style={{ marginTop: 16 }}>
        {tab === 'bills' && <BillsTab />}
        {tab === 'subscribers' && <UsersTab onNotice={setNotice} />}
      </div>
    </>
  );
}

/* ------------------------------ Monthly bills ------------------------------ */

function BillsTab() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(monthStr());
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ items: [], totals: null, loading: true, error: '' });
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');

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
              message='Add users in the "Users" tab (or import your Excel sheet), then press "Generate bills".'
            />
          ) : (
            <div className="table-wrap">
              <table className="table table--even">
                <thead>
                  <tr>
                    <th>User</th><th>Unit</th><th>Address</th><th className="text-right">Fee</th>
                    <th>Status</th><th className="text-right">Received</th><th className="text-right">Arrears</th>
                    <th>Rec. By</th><th>Date</th><th />
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
                        <button className="btn btn--sm" onClick={() => setPaying(r)}>
                          {r.paymentStatus === 'Received' ? 'Details' : 'Receive'}
                        </button>
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
    </>
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

/* ---------------------------------- Users ---------------------------------- */

/** Customers (the default) or the billing users imported from the old Excel sheet. */
function UsersTab({ onNotice }) {
  const [view, setView] = useState('customers');
  return (
    <>
      <div className="seg" role="group" aria-label="Show">
        <button className={`seg__btn${view === 'customers' ? ' is-active' : ''}`} aria-pressed={view === 'customers'} onClick={() => setView('customers')}>
          All customers
        </button>
        <button className={`seg__btn${view === 'imported' ? ' is-active' : ''}`} aria-pressed={view === 'imported'} onClick={() => setView('imported')}>
          Billing list (Excel)
        </button>
      </div>
      {view === 'customers' ? <CustomersBillingTab onNotice={onNotice} /> : <SubscribersTab onNotice={onNotice} />}
    </>
  );
}

function CustomersBillingTab({ onNotice }) {
  const [period, setPeriod] = useState(monthStr());
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ items: [], pagination: null, loading: true, error: '' });
  const [billing, setBilling] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/billing/customers', { params: { period, q: query || undefined, page, limit: 50 } });
      setState({ items: data.items, pagination: data.pagination, loading: false, error: '' });
    } catch (e) {
      setState({ items: [], pagination: null, loading: false, error: errorMessage(e) });
    }
  }, [period, query, page]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <>
      {state.error ? <Alert tone="error" title="Error">{state.error}</Alert> : null}
      <div className="card">
        <div className="filters">
          <div className="filters__item">
            <Field label="Month">
              <TextInput type="month" value={period} onChange={(e) => { if (e.target.value) { setPeriod(e.target.value); setPage(1); } }} />
            </Field>
          </div>
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput placeholder="Name, reference, address, contact…" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            </Field>
          </div>
        </div>
        <div className="card__body card__body--flush">
          {state.loading && !state.items.length ? (
            <TableSkeleton rows={8} cols={6} />
          ) : state.items.length === 0 ? (
            <EmptyState icon="👥" title="No customers found" message="Add customers in the Customers module, then bill them from here." />
          ) : (
            <div className="table-wrap">
              <table className="table table--users table--even">
                <thead>
                  <tr>
                    <th>Customer</th><th>Package</th><th>Address</th><th className="text-right">Monthly Fee</th>
                    <th>{period} bill</th><th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <div className="strong">{c.name}</div>
                        <div className="small muted">{c.customerReferenceNumber}</div>
                      </td>
                      <td className="small">{c.bandwidth || '–'}</td>
                      <td className="small">{c.address || '–'}</td>
                      <td className="text-right num">{c.monthlyFee ? formatMoney(c.monthlyFee) : <span className="muted small">Not set</span>}</td>
                      <td>
                        {c.bill ? (
                          <Badge tone={STATUS_TONE[c.bill.paymentStatus]}>{c.bill.paymentStatus}</Badge>
                        ) : (
                          <span className="muted small">No bill</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button className={`btn btn--sm${c.bill ? ' btn--secondary' : ''}`} onClick={() => setBilling(c)}>
                          {c.bill ? 'Update bill' : 'Generate monthly bill'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination pagination={state.pagination} onChange={setPage} />
        </div>
      </div>

      <CustomerBillModal
        customer={billing}
        period={period}
        onClose={() => setBilling(null)}
        onSaved={async (created, record) => {
          setBilling(null);
          onNotice(`${created ? 'Bill created' : 'Bill updated'}: ${record.username}, ${record.period}, ${formatMoney(record.fee)}.`);
          await load();
        }}
      />
    </>
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

/* -------------------------------- Subscribers ------------------------------ */

const EMPTY = { username: '', package: '', address: '', contact: '', monthlyFee: '', status: 'Active' };

function SubscribersTab({ onNotice }) {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [state, setState] = useState({ items: [], loading: true, error: '' });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/billing/subscribers', { params: { q: query || undefined, limit: 200 } });
      setState({ items: data.items, loading: false, error: '' });
    } catch (e) {
      setState({ items: [], loading: false, error: errorMessage(e) });
    }
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const save = async () => {
    setError('');
    try {
      const body = { ...editing, monthlyFee: Number(editing.monthlyFee) || 0 };
      if (editing._id) await api.put(`/billing/subscribers/${editing._id}`, body);
      else await api.post('/billing/subscribers', body);
      setEditing(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete ${s.username} and all their billing history?`)) return;
    try {
      await api.delete(`/billing/subscribers/${s._id}`);
      await load();
    } catch (e) {
      setState((x) => ({ ...x, error: errorMessage(e) }));
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post(`/billing/subscribers/import?period=${monthStr()}`, body);
      onNotice(
        `Imported ${data.rows} rows: ${data.created} new users, ${data.updated} updated, ` +
        `${data.billsCreated} ${data.period} bills, ${data.paymentsAdded} payments.`,
      );
      await load();
    } catch (e) {
      setState((x) => ({ ...x, error: errorMessage(e) }));
    } finally {
      setImporting(false);
    }
  };

  const activeCount = state.items.filter((s) => s.status === 'Active').length;
  const monthlyTotal = state.items.filter((s) => s.status === 'Active').reduce((sum, s) => sum + s.monthlyFee, 0);

  return (
    <>
      {state.error ? <Alert tone="error" title="Error">{state.error}</Alert> : null}
      <div className="grid grid--stats grid--stats-3">
        <Stat label="Total Users" value={state.items.length} hint="registered subscribers" />
        <Stat label="Active" value={activeCount} hint={`${state.items.length - activeCount} inactive`} tone="ok" />
        <Stat label="Monthly Billing" value={formatMoney(monthlyTotal)} hint="from active users" />
      </div>
      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput placeholder="Username, address, package…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
          </div>
          <button className="btn" onClick={() => { setError(''); setEditing({ ...EMPTY }); }}>＋ Add user</button>
          <button className="btn btn--secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '⭳ Import Excel'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importFile} />
        </div>
        <div className="card__body card__body--flush">
          {state.loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No users yet"
              message="Add users one by one, or import your Excel sheet (columns: USER, DATED, Unit, Status, ADRESS, Fee, Received, Rec. By). Import also creates this month's bills."
            />
          ) : (
            <div className="table-wrap">
              <table className="table table--users table--even">
                <thead>
                  <tr><th>User</th><th>Unit</th><th>Address</th><th className="text-right">Monthly Fee</th><th>Status</th><th className="text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {state.items.map((s) => (
                    <tr key={s._id}>
                      <td className="strong">{s.username}</td>
                      <td className="small">{s.package}</td>
                      <td className="small">{s.address}</td>
                      <td className="text-right num">{formatMoney(s.monthlyFee)}</td>
                      <td><Badge tone={s.status === 'Active' ? 'ok' : 'neutral'}>{s.status}</Badge></td>
                      <td className="text-right"><div className="row-actions">
                        <button className="btn btn--secondary btn--sm" onClick={() => { setError(''); setEditing({ ...s }); }}>Edit</button>
                        {user?.role === 'admin' ? (
                          <button className="btn btn--secondary btn--sm btn--delete" onClick={() => remove(s)}>Delete</button>
                        ) : null}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?._id ? 'Edit user' : 'Add user'}
        footer={
          <>
            <button className="btn btn--secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn" onClick={save}>Save</button>
          </>
        }
      >
        {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
        {editing ? (
          <>
            <Field label="Username" required>
              <TextInput value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
            </Field>
            <Field label="Package (e.g. 15-Mbps)">
              <TextInput value={editing.package || ''} onChange={(e) => setEditing({ ...editing, package: e.target.value })} />
            </Field>
            <Field label="Monthly fee">
              <TextInput type="number" min="0" value={editing.monthlyFee} onChange={(e) => setEditing({ ...editing, monthlyFee: e.target.value })} />
            </Field>
            <Field label="Address">
              <TextInput value={editing.address || ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </Field>
            <Field label="Contact">
              <TextInput value={editing.contact || ''} onChange={(e) => setEditing({ ...editing, contact: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </Field>
          </>
        ) : null}
      </Modal>
    </>
  );
}
