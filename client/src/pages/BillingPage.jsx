import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, EmptyState, Field, Modal, Select, Stat, Tabs, TableSkeleton, TextInput,
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
        subtitle="Monthly bills, payments received and daily recovery — replaces the Excel sheet."
      />
      {notice ? <Alert tone="success" title="Done">{notice}</Alert> : null}
      <Tabs
        tabs={[
          { key: 'bills', label: 'Monthly Bills' },
          { key: 'recovery', label: 'Daily Recovery' },
          { key: 'subscribers', label: 'Users' },
        ]}
        active={tab}
        onChange={(t) => { setTab(t); setNotice(''); }}
      />
      <div className="stack" style={{ marginTop: 16 }}>
        {tab === 'bills' && <BillsTab />}
        {tab === 'recovery' && <RecoveryTab />}
        {tab === 'subscribers' && <SubscribersTab onNotice={setNotice} />}
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

      <div className="grid grid--stats">
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
          <button className="btn btn--secondary btn--sm" onClick={generate} disabled={busy}>
            ＋ Generate {period} bills
          </button>
          <button className="btn btn--secondary btn--sm" onClick={download}>⭳ Excel</button>
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
              <table className="table">
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

/* ------------------------------ Daily recovery ----------------------------- */

function RecoveryTab() {
  const [date, setDate] = useState(todayStr());
  const [state, setState] = useState({ data: null, loading: true, error: '' });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.get('/billing/recovery', { params: { date } })
      .then(({ data }) => !cancelled && setState({ data, loading: false, error: '' }))
      .catch((e) => !cancelled && setState({ data: null, loading: false, error: errorMessage(e) }));
    return () => { cancelled = true; };
  }, [date]);

  const d = state.data;
  return (
    <>
      {state.error ? <Alert tone="error" title="Could not load recovery">{state.error}</Alert> : null}
      <div className="card">
        <div className="filters">
          <div className="filters__item">
            <Field label="Day">
              <TextInput type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>

      {d ? (
        <>
          <div className="grid grid--stats">
            <Stat label={`Recovered on ${d.date}`} value={formatMoney(d.total)} hint={`${d.count} payments`} tone="ok" />
            <Stat label={`${d.month.period} recovered`} value={formatMoney(d.month.received)} hint={`of ${formatMoney(d.month.fee)} billed`} />
            <Stat label={`${d.month.period} outstanding`} value={formatMoney(d.month.arrears)} tone="danger" />
          </div>

          {d.byReceiver.length ? (
            <div className="card">
              <div className="card__body">
                <h4>By receiver</h4>
                {d.byReceiver.map((r) => (
                  <div key={r.name} className="row-between"><span>{r.name}</span><strong>{formatMoney(r.amount)}</strong></div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="card__body card__body--flush">
              {d.payments.length === 0 ? (
                <EmptyState icon="💰" title="No payments on this day" />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Time</th><th>User</th><th>Month</th><th className="text-right">Amount</th><th>Rec. By</th></tr></thead>
                    <tbody>
                      {d.payments.map((p) => (
                        <tr key={p.paymentId}>
                          <td className="nowrap small">{formatDateTime(p.receivedAt)}</td>
                          <td className="strong">{p.username}</td>
                          <td className="small">{p.period}</td>
                          <td className="text-right num">{formatMoney(p.amount)}</td>
                          <td className="small">{p.receivedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card__body card__body--flush">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Day ({d.month.period})</th><th>Payments</th><th className="text-right">Recovered</th></tr></thead>
                  <tbody>
                    {d.month.daily.map((x) => (
                      <tr key={x.date} style={{ cursor: 'pointer' }} onClick={() => setDate(x.date)}>
                        <td>{x.date}</td><td>{x.count}</td><td className="text-right num">{formatMoney(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : state.loading ? <TableSkeleton rows={4} cols={4} /> : null}
    </>
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

  return (
    <>
      {state.error ? <Alert tone="error" title="Error">{state.error}</Alert> : null}
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
              <table className="table">
                <thead>
                  <tr><th>User</th><th>Unit</th><th>Address</th><th className="text-right">Monthly Fee</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {state.items.map((s) => (
                    <tr key={s._id}>
                      <td className="strong">{s.username}</td>
                      <td className="small">{s.package}</td>
                      <td className="small">{s.address}</td>
                      <td className="text-right num">{formatMoney(s.monthlyFee)}</td>
                      <td><Badge tone={s.status === 'Active' ? 'ok' : 'neutral'}>{s.status}</Badge></td>
                      <td className="nowrap">
                        <button className="btn btn--ghost btn--sm" onClick={() => { setError(''); setEditing({ ...s }); }}>Edit</button>
                        {user?.role === 'admin' ? (
                          <button className="btn btn--ghost btn--sm" onClick={() => remove(s)}>Delete</button>
                        ) : null}
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
