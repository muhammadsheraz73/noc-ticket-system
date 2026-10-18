import { useCallback, useEffect, useState } from 'react';
import { Boxes, Package, TriangleAlert, Wallet } from 'lucide-react';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Field, Loading, Modal, Select, TextInput, Textarea,
} from '../components/ui.jsx';
import { formatDateTime, formatMoney, formatNumber } from '../utils/format.js';

const UNITS = ['pcs', 'meter', 'roll', 'box', 'set', 'kg'];

const BLANK = {
  sku: '', name: '', category: '', unit: 'pcs', quantity: 0, minStock: 0,
  costPrice: 0, salePrice: 0, location: '', supplier: '', notes: '',
};

const MOVEMENT_LABEL = { in: 'Stock in', out: 'Stock out', adjust: 'Count adjusted' };
const MOVEMENT_TONE = { in: 'ok', out: 'warn', adjust: 'info' };

/** Stock items (SKUs) — add items, receive and issue stock, see every movement. */
export default function InventoryPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new item
  const [stocking, setStocking] = useState(null); // { item, type }
  const [history, setHistory] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, meta] = await Promise.all([
        api.get('/inventory/items', {
          params: { q: query || undefined, category: category || undefined, lowStock: lowOnly || undefined },
        }),
        api.get('/inventory/meta'),
      ]);
      setItems(data.items);
      setSummary(data.summary);
      setCategories(meta.data.categories);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query, category, lowOnly]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 320 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const [exporting, setExporting] = useState('');

  /** The complete inventory, regardless of the filters on screen. */
  const download = async (format) => {
    setExporting(format);
    try {
      const response = await api.get('/inventory/export', { params: { format }, responseType: 'blob' });
      const name = /filename="([^"]+)"/.exec(response.headers['content-disposition'] || '')?.[1] || `inventory.${format}`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(response.data);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      toast.success('Inventory downloaded', name);
    } catch (err) {
      toast.error('Could not download the inventory', errorMessage(err));
    } finally {
      setExporting('');
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/inventory/items/${deleting._id}`);
      toast.success('Item deleted', deleting.sku);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete the item', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Inventory"
        subtitle="Your stock by SKU — add items, receive and issue stock, and track every movement."
        actions={
          <>
            <button className="btn btn--excel" onClick={() => download('xlsx')} disabled={Boolean(exporting)} title="Download the complete inventory as Excel">
              {exporting === 'xlsx' ? <span className="spinner" /> : '⭳'} Excel
            </button>
            <button className="btn btn--secondary" onClick={() => download('pdf')} disabled={Boolean(exporting)} title="Download the complete inventory as PDF">
              {exporting === 'pdf' ? <span className="spinner spinner--dark" /> : '⭳'} PDF
            </button>
            <button className="btn" onClick={() => setEditing(null)}>＋ Add SKU</button>
          </>
        }
      />

      {error ? <Alert tone="error" title="Could not load inventory">{error}</Alert> : null}

      <div className="kpi-row">
        <Kpi icon={Package} tone="brand" label="Total SKUs" value={formatNumber(summary?.skus)} hint="Items in the catalogue" />
        <Kpi
          icon={Boxes}
          tone="ok"
          label="Units in stock"
          value={formatNumber(summary?.units)}
          hint={`Across ${formatNumber(summary?.skus)} SKUs`}
        />
        <Kpi
          icon={TriangleAlert}
          tone={summary?.lowStock ? 'danger' : 'muted'}
          label="Low stock"
          value={formatNumber(summary?.lowStock)}
          hint={lowOnly ? 'Showing low stock only · click to show all' : summary?.lowStock ? 'At or below reorder level · click to view' : 'Everything above reorder level'}
          active={lowOnly}
          onClick={summary?.lowStock || lowOnly ? () => setLowOnly((v) => !v) : undefined}
        />
        <Kpi
          icon={Wallet}
          tone="info"
          label="Stock value"
          prefix="PKR"
          value={formatNumber(Math.round(summary?.value || 0))}
          hint="At cost price"
          title={formatMoney(summary?.value)}
        />
      </div>

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="SKU, item name, category, location, supplier…"
              />
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Category">
              <Select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <div className="filters__item" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
            <label className="checkbox">
              <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
              Low stock only
            </label>
          </div>
        </div>

        <div className="card__body card__body--flush">
          {loading ? (
            <Loading label="Loading inventory…" />
          ) : items.length === 0 ? (
            <EmptyState
              icon="📦"
              title={query || category || lowOnly ? 'No items found' : 'No SKUs yet'}
              message={query || category || lowOnly ? 'Nothing matches these filters.' : 'Add your first SKU to start tracking stock.'}
              action={!query && !category && !lowOnly ? <button className="btn" onClick={() => setEditing(null)}>＋ Add SKU</button> : null}
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>SKU</th><th>Item</th><th>Category</th><th className="text-right">In stock</th>
                    <th className="text-right">Cost</th><th className="text-right">Sale</th><th>Location</th><th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const low = item.quantity <= item.minStock;
                    return (
                      <tr key={item._id}>
                        <td className="mono strong">{item.sku}</td>
                        <td>
                          <div className="strong">{item.name}</div>
                          {item.supplier ? <div className="small muted">{item.supplier}</div> : null}
                        </td>
                        <td>{item.category ? <Badge tone="outline">{item.category}</Badge> : <span className="muted">—</span>}</td>
                        <td className="text-right nowrap">
                          <span className="strong">{formatNumber(item.quantity)}</span> <span className="muted small">{item.unit}</span>
                          {low ? <div><Badge tone="danger">Low · min {formatNumber(item.minStock)}</Badge></div> : null}
                        </td>
                        <td className="text-right nowrap">{formatMoney(item.costPrice)}</td>
                        <td className="text-right nowrap">{formatMoney(item.salePrice)}</td>
                        <td className="small">{item.location || '—'}</td>
                        <td>
                          <div className="table__actions">
                            <button className="btn btn--secondary btn--sm" onClick={() => setStocking({ item, type: 'in' })}>＋ In</button>
                            <button className="btn btn--secondary btn--sm" onClick={() => setStocking({ item, type: 'out' })}>− Out</button>
                            <button className="btn btn--ghost btn--sm" onClick={() => setHistory(item)}>History</button>
                            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(item)}>Edit</button>
                            {user?.role === ROLES.ADMIN ? (
                              <button className="btn btn--ghost btn--sm text-danger" onClick={() => setDeleting(item)}>Delete</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ItemFormModal
        open={editing !== undefined}
        item={editing}
        categories={categories}
        onClose={() => setEditing(undefined)}
        onSaved={() => { setEditing(undefined); load(); }}
      />
      <StockModal
        stocking={stocking}
        onClose={() => setStocking(null)}
        onSaved={() => { setStocking(null); load(); }}
      />
      <HistoryModal item={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this SKU?"
        message={deleting ? `${deleting.sku} — ${deleting.name} and its whole stock history will be removed. This cannot be undone.` : ''}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

/** One summary tile: icon, label, a single-line value and a short hint. */
function Kpi({ icon: Icon, tone, label, value, prefix, hint, title, active = false, onClick }) {
  const body = (
    <>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        <span className={`kpi__icon kpi__icon--${tone}`} aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>
      </div>
      <div className="kpi__value" title={title}>
        {prefix ? <span className="kpi__prefix">{prefix}</span> : null}
        {value}
      </div>
      <div className="kpi__hint">{hint}</div>
    </>
  );
  const className = `kpi kpi--${tone}${active ? ' is-active' : ''}${onClick ? ' kpi--clickable' : ''}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={active}>{body}</button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function ItemFormModal({ open, item, categories, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError('');
    setForm(item ? { ...BLANK, ...item } : BLANK);
  }, [open, item]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    const body = {
      sku: form.sku, name: form.name, category: form.category, unit: form.unit,
      minStock: form.minStock, costPrice: form.costPrice, salePrice: form.salePrice,
      location: form.location, supplier: form.supplier, notes: form.notes,
    };
    try {
      if (item) {
        await api.put(`/inventory/items/${item._id}`, body);
        toast.success('Item updated', form.sku);
      } else {
        await api.post('/inventory/items', { ...body, quantity: form.quantity });
        toast.success('SKU added', `${form.sku.toUpperCase()} — ${form.name}`);
      }
      onSaved();
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
      title={item ? `Edit ${item.sku}` : 'Add SKU'}
      onClose={busy ? undefined : onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {item ? 'Save changes' : 'Add SKU'}
          </button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="SKU" required error={errors.sku} hint="Unique code, e.g. ONT-HW-8546">
            <TextInput value={form.sku} onChange={set('sku')} error={errors.sku} required placeholder="ONT-HW-8546" />
          </Field>
          <Field label="Item name" required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} error={errors.name} required placeholder="Huawei ONT HG8546M" />
          </Field>
          <Field label="Category" error={errors.category}>
            <TextInput value={form.category} onChange={set('category')} error={errors.category} list="inventory-categories" placeholder="ONT / Router / Cable / SFP…" />
            <datalist id="inventory-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Unit" error={errors.unit}>
            <Select value={form.unit} onChange={set('unit')} error={errors.unit}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
          {item ? null : (
            <Field label="Opening stock" error={errors.quantity} hint="Quantity you have right now">
              <TextInput type="number" min="0" step="any" value={form.quantity} onChange={set('quantity')} error={errors.quantity} />
            </Field>
          )}
          <Field label="Reorder level" error={errors.minStock} hint="Flagged as low stock at or below this">
            <TextInput type="number" min="0" step="any" value={form.minStock} onChange={set('minStock')} error={errors.minStock} />
          </Field>
          <Field label="Cost price (PKR)" error={errors.costPrice}>
            <TextInput type="number" min="0" step="any" value={form.costPrice} onChange={set('costPrice')} error={errors.costPrice} />
          </Field>
          <Field label="Sale price (PKR)" error={errors.salePrice}>
            <TextInput type="number" min="0" step="any" value={form.salePrice} onChange={set('salePrice')} error={errors.salePrice} />
          </Field>
          <Field label="Location" error={errors.location}>
            <TextInput value={form.location} onChange={set('location')} error={errors.location} placeholder="Main store, Rack A" />
          </Field>
          <Field label="Supplier" error={errors.supplier}>
            <TextInput value={form.supplier} onChange={set('supplier')} error={errors.supplier} />
          </Field>
          <Field label="Notes" error={errors.notes} full>
            <Textarea rows={2} value={form.notes} onChange={set('notes')} error={errors.notes} />
          </Field>
        </div>
        {item ? (
          <Alert tone="info">To change the quantity, use ＋ In, − Out or a count adjustment so the history stays correct.</Alert>
        ) : null}
      </form>
    </Modal>
  );
}

function StockModal({ stocking, onClose, onSaved }) {
  const toast = useToast();
  const [type, setType] = useState('in');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const item = stocking?.item;

  useEffect(() => {
    if (!stocking) return;
    setType(stocking.type);
    setQuantity('');
    setNote('');
    setError('');
  }, [stocking]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/inventory/items/${item._id}/stock`, { type, quantity, note });
      toast.success(MOVEMENT_LABEL[type], `${item.sku} — now ${formatNumber(data.item.quantity)} ${item.unit}`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(stocking)}
      title={item ? `${item.sku} — ${item.name}` : ''}
      onClose={busy ? undefined : onClose}
      size="sm"
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" onClick={submit} disabled={busy || quantity === ''}>
            {busy ? <span className="spinner" /> : null}
            Save
          </button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {item ? (
        <form onSubmit={submit}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Currently in stock: <strong>{formatNumber(item.quantity)} {item.unit}</strong>
          </p>
          <Field label="Action">
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="in">Stock in — received / purchased</option>
              <option value="out">Stock out — issued / used / sold</option>
              <option value="adjust">Adjust — set to physical count</option>
            </Select>
          </Field>
          <Field label={type === 'adjust' ? `New count (${item.unit})` : `Quantity (${item.unit})`} required>
            <TextInput type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus required />
          </Field>
          <Field label="Note" hint="e.g. PO number, customer ID, technician name">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </form>
      ) : null}
    </Modal>
  );
}

function HistoryModal({ item, onClose }) {
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    if (!item) return;
    setState({ loading: true, items: [], error: '' });
    api
      .get(`/inventory/items/${item._id}/movements`)
      .then(({ data }) => setState({ loading: false, items: data.items, error: '' }))
      .catch((err) => setState({ loading: false, items: [], error: errorMessage(err) }));
  }, [item]);

  return (
    <Modal
      open={Boolean(item)}
      title={item ? `Stock history — ${item.sku}` : ''}
      onClose={onClose}
      size="lg"
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.loading ? (
        <Loading label="Loading history…" />
      ) : state.items.length === 0 ? (
        <EmptyState icon="🕘" title="No movements yet" message="Stock in, out and adjustments will appear here." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Action</th><th className="text-right">Qty</th><th className="text-right">Balance</th><th>Note</th><th>By</th></tr>
            </thead>
            <tbody>
              {state.items.map((m) => (
                <tr key={m._id}>
                  <td className="small nowrap">{formatDateTime(m.createdAt)}</td>
                  <td><Badge tone={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge></td>
                  <td className="text-right mono">
                    {m.type === 'in' ? '+' : m.type === 'out' ? '−' : '±'}{formatNumber(m.quantity)}
                  </td>
                  <td className="text-right mono strong">{formatNumber(m.balanceAfter)}</td>
                  <td className="small">{m.note || '—'}</td>
                  <td className="small muted">{m.byName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
