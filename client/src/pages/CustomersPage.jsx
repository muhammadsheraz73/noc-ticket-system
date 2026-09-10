import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import CustomerFormModal from './CustomerFormModal.jsx';
import {
  Alert, Badge, ConfirmDialog, EmptyState, Pagination, TableSkeleton, Field, TextInput, Select,
} from '../components/ui.jsx';
import { formatDate } from '../utils/format.js';

export default function CustomersPage() {
  const { canManageTickets, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState({ items: [], pagination: null, loading: true, error: '' });
  const [query, setQuery] = useState(params.get('q') || '');
  const [type, setType] = useState(params.get('type') || '');
  const [page, setPage] = useState(1);
  const [types, setTypes] = useState([]);

  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    api.get('/customers/meta').then(({ data }) => setTypes(data.types)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data } = await api.get('/customers', {
        params: { q: query || undefined, type: type || undefined, page, limit: 20 },
      });
      setState({ items: data.items, pagination: data.pagination, loading: false, error: '' });
    } catch (error) {
      setState({ items: [], pagination: null, loading: false, error: errorMessage(error) });
    }
  }, [query, type, page]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, query ? 320 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (type) next.set('type', type);
    setParams(next, { replace: true });
  }, [query, type, setParams]);

  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      await api.delete(`/customers/${deleting._id}`);
      toast.success('Customer archived', `${deleting.customerReferenceNumber} was soft deleted.`);
      setDeleting(null);
      load();
    } catch (error) {
      toast.error('Could not archive customer', errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Customers"
        subtitle="Customer master data — network details stay internal and searchable."
        actions={
          canManageTickets ? (
            <>
              <Link className="btn btn--secondary" to="/customers/import">⭳ Import Excel</Link>
              <button className="btn" onClick={() => { setEditing(null); setFormOpen(true); }}>
                ＋ New Customer
              </button>
            </>
          ) : null
        }
      />

      {state.error ? <Alert tone="error" title="Could not load customers">{state.error}</Alert> : null}

      <div className="card">
        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput
                placeholder="Reference, name, address, contact, VLAN, port…"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              />
            </Field>
          </div>
          <div className="filters__item">
            <Field label="Type">
              <Select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
                <option value="">All types</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
          {query || type ? (
            <button className="btn btn--ghost btn--sm" onClick={() => { setQuery(''); setType(''); setPage(1); }}>
              Clear
            </button>
          ) : null}
        </div>

        <div className="card__body card__body--flush">
          {state.loading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : state.items.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No customers found"
              message={query || type ? 'Try a different search or filter.' : 'Add your first customer or import from Excel.'}
              action={
                canManageTickets ? (
                  <button className="btn" onClick={() => { setEditing(null); setFormOpen(true); }}>＋ New Customer</button>
                ) : null
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer ID</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Connected From</th>
                    <th>Contact</th>
                    <th>VLAN / Ports</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((customer) => (
                    <tr key={customer._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${customer.customerReferenceNumber}`)}>
                      <td><span className="tid">{customer.customerReferenceNumber}</span></td>
                      <td>
                        <div className="strong">{customer.name}</div>
                        <div className="small muted truncate" title={customer.address}>{customer.address}</div>
                      </td>
                      <td><Badge tone="outline">{customer.type}</Badge></td>
                      <td className="nowrap">{customer.connectedFrom}</td>
                      <td className="nowrap mono">{customer.contactNumber}</td>
                      <td className="small mono">
                        {customer.vlan ? `VLAN ${customer.vlan}` : <span className="muted">no VLAN</span>}
                        <br />
                        <span className="muted">
                          {customer.sourcePort || '—'} → {customer.destinationPort || '—'}
                        </span>
                      </td>
                      <td className="nowrap small muted">{formatDate(customer.createdAt)}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="table__actions">
                          {canManageTickets ? (
                            <button className="btn btn--secondary btn--sm" onClick={() => { setEditing(customer); setFormOpen(true); }}>
                              Edit
                            </button>
                          ) : null}
                          {isAdmin ? (
                            <button className="btn btn--ghost btn--sm text-danger" onClick={() => setDeleting(customer)}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Pagination pagination={state.pagination} onChange={setPage} />
      </div>

      <CustomerFormModal
        open={formOpen}
        customer={editing}
        types={types}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={() => { setFormOpen(false); setEditing(null); load(); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Archive this customer?"
        message={`${deleting?.customerReferenceNumber} — ${deleting?.name} will be soft deleted. Ticket and invoice history is kept, and the action is written to the audit log.`}
        confirmLabel="Archive customer"
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
