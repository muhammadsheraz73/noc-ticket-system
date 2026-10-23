import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, Field, Loading, TextInput, Textarea } from '../components/ui.jsx';
import { formatMoney } from '../utils/format.js';
import { downloadQuotationPdf } from '../utils/quotationPdf.js';

const UNITS = ['pcs', 'meter', 'job', 'month', 'year', 'set', 'roll', 'box', 'hour', 'lot'];
const BLANK_ITEM = { description: '', quantity: 1, unit: 'pcs', rate: 0 };
const BLANK = {
  customer: '',
  customerReferenceNumber: '',
  clientName: '',
  clientCompany: '',
  clientPhone: '',
  clientEmail: '',
  clientAddress: '',
  subject: '',
  issueDate: '',
  validUntil: '',
  status: 'Draft',
  discountType: 'none',
  discountValue: '',
  notes: '',
  terms: '',
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DISCOUNT_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'percent', label: 'Percent (%)' },
  { value: 'amount', label: 'Amount (PKR)' },
];
const toInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

/** Create a quotation, or edit one (`/quotations/:id/edit`). */
export default function QuotationFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();

  const [form, setForm] = useState(BLANK);
  const [items, setItems] = useState([{ ...BLANK_ITEM }]);
  const [number, setNumber] = useState('');
  const [hasLetterhead, setHasLetterhead] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: defaults } = await api.get('/quotations/defaults');
        if (cancelled) return;
        setHasLetterhead(defaults.hasLetterhead);
        if (editing) {
          const { data } = await api.get(`/quotations/${id}`);
          const q = data.quotation;
          if (cancelled) return;
          setNumber(q.quoteNumber);
          setForm({
            ...BLANK,
            ...Object.fromEntries(Object.keys(BLANK).map((k) => [k, q[k] ?? BLANK[k]])),
            customer: q.customer || '',
            issueDate: toInput(q.issueDate),
            validUntil: toInput(q.validUntil),
            discountValue: q.discountType === 'none' ? '' : String(q.discountValue ?? ''),
          });
          setItems(q.items.map((it) => ({ description: it.description, quantity: it.quantity, unit: it.unit || '', rate: it.rate })));
        } else {
          setForm({ ...BLANK, issueDate: toInput(defaults.issueDate), validUntil: toInput(defaults.validUntil), terms: defaults.terms || '' });
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editing, id]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const setItem = (index, key, value) => setItems((list) => list.map((it, i) => (i === index ? { ...it, [key]: value } : it)));

  const totals = useMemo(() => {
    const lines = items.map((it) => round2(Math.max(0, Number(it.quantity) || 0) * Math.max(0, Number(it.rate) || 0)));
    const subtotal = round2(lines.reduce((s, v) => s + v, 0));
    const value = Math.max(0, Number(form.discountValue) || 0);
    let discount = 0;
    let discountError = '';
    if (form.discountType === 'percent') {
      if (value > 100) discountError = 'A percentage discount cannot be more than 100%.';
      discount = round2((subtotal * Math.min(100, value)) / 100);
    } else if (form.discountType === 'amount') {
      if (value > subtotal) discountError = `The discount cannot be more than the subtotal (${formatMoney(subtotal)}).`;
      discount = round2(Math.min(subtotal, value));
    }
    // No tax on quotations: the total is the subtotal less any discount.
    return { lines, subtotal, discount, discountError, total: round2(subtotal - discount) };
  }, [items, form.discountType, form.discountValue]);

  const setDiscountType = (type) => setForm((f) => ({ ...f, discountType: type, discountValue: type === f.discountType ? f.discountValue : '' }));

  const pickCustomer = (c) => setForm((f) => ({
    ...f,
    customer: c._id,
    customerReferenceNumber: c.customerReferenceNumber,
    clientName: c.name,
    clientPhone: c.contactNumber || '',
    clientAddress: c.address || '',
  }));

  const unlink = () => setForm((f) => ({ ...f, customer: '', customerReferenceNumber: '' }));

  /** Save, then optionally hand the PDF straight to the browser. */
  const save = async (andDownload = false) => {
    setBusy(andDownload ? 'download' : 'save');
    setError('');
    setErrors({});
    if (totals.discountError) {
      setBusy('');
      setErrors({ discountValue: totals.discountError });
      return;
    }
    const body = {
      ...form,
      discountValue: form.discountType === 'none' ? 0 : Number(form.discountValue) || 0,
      issueDate: form.issueDate || undefined,
      validUntil: form.validUntil || undefined,
      items: items.filter((it) => String(it.description).trim() || Number(it.rate) > 0),
    };
    delete body.customerReferenceNumber;
    delete body.status;
    try {
      const { data } = editing
        ? await api.put(`/quotations/${id}`, body)
        : await api.post('/quotations', body);
      toast.success(editing ? 'Quotation updated' : 'Quotation created', data.quotation.quoteNumber);
      if (andDownload) {
        try {
          await downloadQuotationPdf(data.quotation);
        } catch (err) {
          toast.error('Saved, but the PDF could not be downloaded', errorMessage(err));
        }
      }
      navigate(`/quotations/${data.quotation._id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy('');
    }
  };

  if (loading) return <Loading label="Loading…" />;

  return (
    <>
      <PageHead
        back={editing ? `/quotations/${id}` : '/quotations'}
        title={editing ? `Edit ${number}` : 'New Quotation'}
        subtitle="Prices are recalculated on the server when you save."
      />

      {loadError ? <Alert tone="error">{loadError}</Alert> : null}
      {error ? <Alert tone="error" title="Could not save">{error}</Alert> : null}
      {!hasLetterhead ? (
        <Alert tone="info" title="Your letterhead is not set up yet">
          {isAdmin
            ? <>Add your logo, address and contact details in <Link to="/settings">Settings → Company profile</Link> so quotations print on your letterhead.</>
            : 'Ask your admin to add the company logo and address under Settings → Company profile.'}
        </Alert>
      ) : null}

      <div className="stack">
        <div className="grid grid--2">
          <div className="card">
            <div className="card__head"><h2>Quotation for</h2></div>
            <div className="card__body">
              <CustomerSearch linked={form.customer ? form : null} onPick={pickCustomer} onUnlink={unlink} />
              <div className="form-grid">
                <Field label="Client name" required error={errors.clientName}>
                  <TextInput value={form.clientName} onChange={set('clientName')} error={errors.clientName} placeholder="Abdul Rouf" />
                </Field>
                <Field label="Company" error={errors.clientCompany}>
                  <TextInput value={form.clientCompany} onChange={set('clientCompany')} placeholder="Rouf Traders" />
                </Field>
                <Field label="Phone" error={errors.clientPhone}>
                  <TextInput value={form.clientPhone} onChange={set('clientPhone')} placeholder="0333-4458420" />
                </Field>
                <Field label="Email" error={errors.clientEmail}>
                  <TextInput type="email" value={form.clientEmail} onChange={set('clientEmail')} />
                </Field>
                <Field label="Address" error={errors.clientAddress} full>
                  <Textarea rows={2} value={form.clientAddress} onChange={set('clientAddress')} />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2>Details</h2></div>
            <div className="card__body">
              <div className="form-grid">
                <Field label="Subject" error={errors.subject} full hint="One line that says what this quote is for.">
                  <TextInput value={form.subject} onChange={set('subject')} placeholder="New fiber connection — 50 MB business package" />
                </Field>
                <Field label="Quotation date" error={errors.issueDate}>
                  <TextInput type="date" value={form.issueDate} onChange={set('issueDate')} />
                </Field>
                <Field label="Valid until" error={errors.validUntil}>
                  <TextInput type="date" value={form.validUntil} onChange={set('validUntil')} min={form.issueDate} />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2>Items</h2>
            <span className="small muted">{items.length} line{items.length === 1 ? '' : 's'}</span>
            <div className="card__head-actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setItems((l) => [...l, { ...BLANK_ITEM }])}>＋ Add item</button>
            </div>
          </div>
          <div className="card__body">
            {errors.items ? <div className="field__error" style={{ marginBottom: 8 }}>{errors.items}</div> : null}
            <div className="table-wrap">
              <table className="items-table">
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}>#</th>
                    <th style={{ width: '42%' }}>Description</th>
                    <th style={{ width: '10%' }}>Qty</th>
                    <th style={{ width: '12%' }}>Unit</th>
                    <th style={{ width: '14%' }}>Unit price</th>
                    <th style={{ width: '14%' }} className="text-right">Amount</th>
                    <th style={{ width: '4%' }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index}>
                      <td className="muted" style={{ paddingTop: 14 }}>{index + 1}</td>
                      <td>
                        <TextInput value={item.description} onChange={(e) => setItem(index, 'description', e.target.value)} placeholder="Huawei GPON ONT HG8546M" />
                      </td>
                      <td><TextInput type="number" min="0" step="any" value={item.quantity} onChange={(e) => setItem(index, 'quantity', e.target.value)} /></td>
                      <td>
                        <TextInput list="quotation-units" value={item.unit} onChange={(e) => setItem(index, 'unit', e.target.value)} placeholder="pcs" />
                      </td>
                      <td><TextInput type="number" min="0" step="any" value={item.rate} onChange={(e) => setItem(index, 'rate', e.target.value)} /></td>
                      <td className="text-right num strong" style={{ paddingTop: 14 }}>{formatMoney(totals.lines[index])}</td>
                      <td style={{ paddingTop: 10 }}>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm text-danger"
                          aria-label="Remove item"
                          onClick={() => setItems((l) => (l.length === 1 ? [{ ...BLANK_ITEM }] : l.filter((_, i) => i !== index)))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="quotation-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
          </div>
        </div>

        <div className="grid grid--2">
          <div className="card">
            <div className="card__head"><h3>Notes & terms</h3></div>
            <div className="card__body">
              <Field label="Notes" hint="Printed above the terms, e.g. delivery or scope notes.">
                <Textarea rows={2} value={form.notes} onChange={set('notes')} />
              </Field>
              <Field label="Terms & conditions" hint="One per line — they are numbered on the PDF. Your default terms are filled in for you.">
                <Textarea rows={5} value={form.terms} onChange={set('terms')} placeholder={'50% advance with the purchase order\nInstallation within 3 working days of payment'} />
              </Field>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h3>Pricing</h3></div>
            <div className="card__body">
              <div className="discount">
                <div className="discount__label" id="discount-type-label">Discount</div>
                <div className="seg" role="radiogroup" aria-labelledby="discount-type-label">
                  {DISCOUNT_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={form.discountType === t.value}
                      className={`seg__btn${form.discountType === t.value ? ' is-active' : ''}`}
                      onClick={() => setDiscountType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {form.discountType !== 'none' ? (
                  <Field
                    label={form.discountType === 'percent' ? 'Discount percentage' : 'Discount amount'}
                    htmlFor="discountValue"
                    error={errors.discountValue || totals.discountError}
                    hint={totals.discount > 0 ? `Customer saves ${formatMoney(totals.discount)} on this quotation.` : undefined}
                  >
                    <div className="input-affix">
                      <TextInput
                        id="discountValue"
                        type="number"
                        min="0"
                        max={form.discountType === 'percent' ? 100 : undefined}
                        step="any"
                        inputMode="decimal"
                        value={form.discountValue}
                        onChange={(e) => { set('discountValue')(e); setErrors((x) => ({ ...x, discountValue: undefined })); }}
                        error={errors.discountValue || totals.discountError}
                        placeholder={form.discountType === 'percent' ? '10' : '5000'}
                      />
                      <span className="input-affix__text" aria-hidden="true">{form.discountType === 'percent' ? '%' : 'PKR'}</span>
                    </div>
                  </Field>
                ) : null}
              </div>

              <div className="totals">
                <div className="totals__row"><span>Subtotal</span><span className="num">{formatMoney(totals.subtotal)}</span></div>
                {totals.discount > 0 ? (
                  <div className="totals__row totals__row--discount">
                    <span>Discount{form.discountType === 'percent' ? ` (${Number(form.discountValue)}%)` : ''}</span>
                    <span className="num">− {formatMoney(totals.discount)}</span>
                  </div>
                ) : null}
                <div className="totals__row totals__row--total"><span>Total</span><span className="num">{formatMoney(totals.total)}</span></div>
              </div>
              <div className="small muted" style={{ marginTop: 12, textAlign: 'right' }}>No tax is applied to quotations.</div>
            </div>
            <div className="card__foot">
              <div className="row row--end">
                <button type="button" className="btn btn--secondary" onClick={() => navigate(editing ? `/quotations/${id}` : '/quotations')} disabled={Boolean(busy)}>Cancel</button>
                <button type="button" className="btn btn--secondary" onClick={() => save(false)} disabled={Boolean(busy) || Boolean(loadError)}>
                  {busy === 'save' ? <span className="spinner spinner--dark" /> : null} {editing ? 'Save changes' : 'Save'}
                </button>
                <button type="button" className="btn" onClick={() => save(true)} disabled={Boolean(busy) || Boolean(loadError)}>
                  {busy === 'download' ? <span className="spinner" /> : '⭳'} Save & Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Find an existing customer to fill the "To" block — optional, prospects can be typed in. */
function CustomerSearch({ linked, onPick, onUnlink }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return undefined; }
    const timer = setTimeout(() => {
      api.get('/customers', { params: { q, limit: 6 } })
        .then(({ data }) => { setResults(data.items); setOpen(true); })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (linked) {
    return (
      <div className="linked-customer">
        <Badge tone="ok">Linked customer</Badge>
        <span className="strong">{linked.clientName}</span>
        <span className="muted small mono">ID {linked.customerReferenceNumber}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onUnlink} style={{ marginLeft: 'auto' }}>Unlink</button>
      </div>
    );
  }

  return (
    <div className="customer-search" ref={box}>
      <Field label="Existing customer (optional)" hint="Search to fill the details below, or just type them in for a new prospect.">
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)} placeholder="Customer ID, name or phone…" />
      </Field>
      {open && results.length ? (
        <div className="customer-search__menu">
          {results.map((c) => (
            <button
              key={c._id}
              type="button"
              className="customer-search__item"
              onClick={() => { onPick(c); setQ(''); setOpen(false); }}
            >
              <span className="mono small muted">{c.customerReferenceNumber}</span>
              <span className="strong">{c.name}</span>
              <span className="small muted">{c.contactNumber}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
