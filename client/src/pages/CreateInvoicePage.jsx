import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, DefItem, Field, Select, TextInput, Textarea } from '../components/ui.jsx';
import { STATUS_TONE, formatDateTime, formatMoney } from '../utils/format.js';

const BLANK_ITEM = { description: '', quantity: 1, rate: 0 };

/**
 * Invoice module — always starts from a Ticket ID.
 * The linked ticket and customer are fetched automatically.
 */
export default function CreateInvoicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [ticketNumber, setTicketNumber] = useState(params.get('ticket') || '');
  const [lookup, setLookup] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [looking, setLooking] = useState(false);

  const [items, setItems] = useState([{ ...BLANK_ITEM }]);
  const [discountType, setDiscountType] = useState('none');
  const [discountValue, setDiscountValue] = useState(0);
  const [taxPercent, setTaxPercent] = useState(0);
  const [status, setStatus] = useState('Unpaid');
  const [notes, setNotes] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState('');

  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const doLookup = async (value) => {
    const number = String(value ?? ticketNumber).trim();
    if (!number) return;
    setLooking(true);
    setLookupError('');
    try {
      const { data } = await api.get(`/invoices/lookup/${number}`);
      setLookup(data);
      setTaxPercent(data.defaults.taxPercent ?? 0);
      setIssueDate(toInput(data.defaults.issueDate));
      setDueDate(toInput(data.defaults.dueDate));
      if (data.existingInvoices?.length) {
        toast.warning(
          `TID ${number} already has ${data.existingInvoices.length} invoice(s)`,
          'You can still raise another one if it is genuinely needed.',
        );
      }
    } catch (err) {
      setLookup(null);
      setLookupError(errorMessage(err));
    } finally {
      setLooking(false);
    }
  };

  useEffect(() => {
    if (params.get('ticket')) doLookup(params.get('ticket'));
    // Run once for the ticket passed in the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const normalized = items.map((item) => ({
      ...item,
      amount: round2((Number(item.quantity) || 0) * (Number(item.rate) || 0)),
    }));
    const subtotal = round2(normalized.reduce((sum, item) => sum + item.amount, 0));
    let discountAmount = 0;
    if (discountType === 'percent') {
      discountAmount = round2((subtotal * clamp(discountValue, 0, 100)) / 100);
    } else if (discountType === 'amount') {
      discountAmount = round2(Math.min(subtotal, Math.max(0, Number(discountValue) || 0)));
    }
    const taxable = round2(subtotal - discountAmount);
    const taxAmount = round2((taxable * Math.max(0, Number(taxPercent) || 0)) / 100);
    return { normalized, subtotal, discountAmount, taxAmount, total: round2(taxable + taxAmount) };
  }, [items, discountType, discountValue, taxPercent]);

  const setItem = (index, key, value) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const submit = async (event) => {
    event.preventDefault();
    if (!lookup) {
      setLookupError('Look up a Ticket ID first');
      return;
    }
    const valid = items.filter((item) => item.description.trim());
    if (!valid.length) {
      setError('Add at least one line item with a description.');
      return;
    }

    setBusy(true);
    setError('');
    setErrors({});
    try {
      const { data } = await api.post('/invoices', {
        ticketNumber: Number(lookup.ticket.ticketNumber),
        items: valid.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity) || 0,
          rate: Number(item.rate) || 0,
        })),
        discountType,
        discountValue: Number(discountValue) || 0,
        taxPercent: Number(taxPercent) || 0,
        status,
        notes,
        issueDate: issueDate || undefined,
        dueDate: dueDate || undefined,
      });
      toast.success(`Invoice ${data.invoice.invoiceNumber} created`, formatMoney(data.invoice.total, data.invoice.currency));
      navigate(`/invoices/${data.invoice._id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      toast.error('Could not create the invoice', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const currency = lookup?.defaults?.currency || 'PKR';

  return (
    <>
      <PageHead back="/invoices" title="Create invoice" subtitle="Enter a Ticket ID — the customer and ticket data is fetched automatically." />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="steps">
        <div className={`step ${lookup ? 'is-done' : 'is-active'}`}><span className="step__num">1</span> Ticket lookup</div>
        <div className={`step ${lookup ? 'is-active' : ''}`}><span className="step__num">2</span> Line items</div>
        <div className="step"><span className="step__num">3</span> Generate</div>
      </div>

      <form onSubmit={submit}>
        <div className="stack">
          <div className="card">
            <div className="card__head"><h2>Ticket ID lookup</h2></div>
            <div className="card__body">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <Field label="Ticket ID (TID)" required error={lookupError} hint="Only an existing ticket can be invoiced.">
                    <TextInput
                      value={ticketNumber}
                      error={lookupError}
                      inputMode="numeric"
                      placeholder="4626"
                      onChange={(event) => { setTicketNumber(event.target.value); setLookup(null); }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); doLookup(); }
                      }}
                    />
                  </Field>
                </div>
                <button type="button" className="btn btn--secondary" onClick={() => doLookup()} disabled={looking || !ticketNumber.trim()}>
                  {looking ? <span className="spinner spinner--dark" /> : null} Fetch ticket
                </button>
              </div>

              {lookup ? (
                <>
                  <Alert tone="ok" title={`TID ${lookup.ticket.ticketNumber} found`}>
                    Customer and ticket details below are linked to this invoice automatically.
                  </Alert>
                  <div className="deflist">
                    <DefItem label="Customer ID" value={lookup.customer.customerReferenceNumber} mono />
                    <DefItem label="Customer" value={lookup.customer.name} />
                    <DefItem label="Address" value={lookup.customer.address} />
                    <DefItem label="Contact" value={lookup.customer.contactNumber} mono />
                    <DefItem label="Issue Type" value={lookup.ticket.issueType} />
                    <DefItem label="Ticket status">
                      <Badge tone={STATUS_TONE[lookup.ticket.status]} dot>{lookup.ticket.status}</Badge>
                    </DefItem>
                    <DefItem label="Ticket created" value={formatDateTime(lookup.ticket.createdAt)} />
                    <DefItem label="Resolved" value={lookup.ticket.resolvedAt ? formatDateTime(lookup.ticket.resolvedAt) : ''} />
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {lookup ? (
            <>
              <div className="card">
                <div className="card__head">
                  <h2>Line items</h2>
                  <div className="card__head-actions">
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => setItems((c) => [...c, { ...BLANK_ITEM }])}>
                      ＋ Add item
                    </button>
                  </div>
                </div>
                <div className="card__body">
                  <div className="table-wrap">
                    <table className="items-table">
                      <thead>
                        <tr>
                          <th style={{ width: '46%' }}>Description</th>
                          <th style={{ width: '13%' }}>Qty</th>
                          <th style={{ width: '18%' }}>Rate</th>
                          <th style={{ width: '18%' }} className="text-right">Amount</th>
                          <th style={{ width: '5%' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, index) => (
                          <tr key={index}>
                            <td>
                              <TextInput
                                value={item.description}
                                onChange={(event) => setItem(index, 'description', event.target.value)}
                                placeholder="Fiber splicing — emergency call out"
                              />
                            </td>
                            <td>
                              <TextInput type="number" min="0" step="any" value={item.quantity}
                                onChange={(event) => setItem(index, 'quantity', event.target.value)} />
                            </td>
                            <td>
                              <TextInput type="number" min="0" step="any" value={item.rate}
                                onChange={(event) => setItem(index, 'rate', event.target.value)} />
                            </td>
                            <td className="text-right num strong" style={{ paddingTop: 14 }}>
                              {formatMoney(totals.normalized[index]?.amount, currency)}
                            </td>
                            <td style={{ paddingTop: 10 }}>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm text-danger"
                                onClick={() => setItems((c) => (c.length === 1 ? [{ ...BLANK_ITEM }] : c.filter((_, i) => i !== index)))}
                                aria-label="Remove item"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="grid grid--2">
                <div className="card">
                  <div className="card__head"><h3>Invoice settings</h3></div>
                  <div className="card__body">
                    <div className="form-grid">
                      <Field label="Issue date" error={errors.issueDate}>
                        <TextInput type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
                      </Field>
                      <Field label="Due date" error={errors.dueDate}>
                        <TextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                      </Field>
                      <Field label="Discount type">
                        <Select value={discountType} onChange={(event) => setDiscountType(event.target.value)}>
                          <option value="none">No discount</option>
                          <option value="percent">Percentage (%)</option>
                          <option value="amount">Fixed amount</option>
                        </Select>
                      </Field>
                      <Field label="Discount value">
                        <TextInput type="number" min="0" step="any" value={discountValue} disabled={discountType === 'none'}
                          onChange={(event) => setDiscountValue(event.target.value)} />
                      </Field>
                      <Field label="Tax %" error={errors.taxPercent}>
                        <TextInput type="number" min="0" max="100" step="any" value={taxPercent}
                          onChange={(event) => setTaxPercent(event.target.value)} />
                      </Field>
                      <Field label="Status">
                        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                          <option value="Draft">Draft</option>
                          <option value="Unpaid">Unpaid</option>
                          <option value="Paid">Paid</option>
                        </Select>
                      </Field>
                      <Field label="Notes" full>
                        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2}
                          placeholder="Emergency restoration charges…" />
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card__head"><h3>Summary</h3></div>
                  <div className="card__body">
                    <div className="totals">
                      <div className="totals__row"><span>Subtotal</span><span className="num">{formatMoney(totals.subtotal, currency)}</span></div>
                      {totals.discountAmount > 0 ? (
                        <div className="totals__row">
                          <span>Discount{discountType === 'percent' ? ` (${discountValue}%)` : ''}</span>
                          <span className="num">− {formatMoney(totals.discountAmount, currency)}</span>
                        </div>
                      ) : null}
                      {totals.taxAmount > 0 ? (
                        <div className="totals__row"><span>Tax ({taxPercent}%)</span><span className="num">{formatMoney(totals.taxAmount, currency)}</span></div>
                      ) : null}
                      <div className="totals__row totals__row--total"><span>Total</span><span className="num">{formatMoney(totals.total, currency)}</span></div>
                    </div>
                    <div className="small muted" style={{ marginTop: 12 }}>
                      Totals are recalculated on the server before saving.
                    </div>
                  </div>
                  <div className="card__foot">
                    <div className="row row--end">
                      <button type="button" className="btn btn--secondary" onClick={() => navigate('/invoices')} disabled={busy}>Cancel</button>
                      <button className="btn" type="submit" disabled={busy}>
                        {busy ? <span className="spinner" /> : null} Create invoice
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </form>
    </>
  );
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
const toInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const today = () => new Date().toISOString().slice(0, 10);
