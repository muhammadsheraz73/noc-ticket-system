import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, EmptyState, Field, Loading, TextInput } from '../components/ui.jsx';
import { STATUS_TONE, PRIORITY_TONE, INVOICE_TONE, formatDateTime, formatMoney } from '../utils/format.js';

const EXAMPLES = ['10255', 'Abdul Rouf', '613', '4626', 'Gajjumata', 'GE0/0/1'];

/** Full-page global search with results separated by entity. */
export default function SearchPage() {
  const navigate = useNavigate();
  const { canViewInvoices, canViewNetwork } = useAuth();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async (term) => {
    const value = String(term || '').trim();
    if (!value) { setResults(null); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/search', { params: { q: value, limit: 25 } });
      setResults(data);
    } catch (err) {
      setError(errorMessage(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const term = params.get('q');
    if (term) { setQuery(term); run(term); }
  }, [params, run]);

  const submit = (event) => {
    event.preventDefault();
    setParams(query.trim() ? { q: query.trim() } : {});
  };

  const network = results?.network || {};

  return (
    <>
      <PageHead
        title="Global search"
        subtitle="Customers, tickets, invoices and internal network inventory in one place."
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__body">
          <form onSubmit={submit}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 320px' }}>
                <Field label="Search everything" hint="Customer reference, name, address, contact, VLAN, port, POP, TID, issue type, remarks or invoice number.">
                  <TextInput
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="10255, Abdul Rouf, 613, 4626, Gajjumata, GE0/0/1…"
                  />
                </Field>
              </div>
              <button className="btn" type="submit" disabled={!query.trim()}>🔍 Search</button>
            </div>
          </form>

          <div className="row small" style={{ marginTop: 4 }}>
            <span className="muted">Try:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                className="btn btn--ghost btn--sm"
                onClick={() => { setQuery(example); setParams({ q: example }); }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? <Alert tone="error" title="Search failed">{error}</Alert> : null}
      {loading ? <Loading label="Searching…" /> : null}

      {!loading && results ? (
        results.total === 0 ? (
          <EmptyState icon="🔍" title={`No results for “${results.query}”`} message="Try a customer reference, name, TID, VLAN or port." />
        ) : (
          <div className="stack">
            <div className="small muted">
              {results.total} result{results.total === 1 ? '' : 's'} for “{results.query}”
            </div>

            <Section title="Customers" count={results.customers.length}>
              <table className="table">
                <thead><tr><th>Customer ID</th><th>Name</th><th>Type</th><th>Connected From</th><th>Contact</th><th>VLAN / Ports</th></tr></thead>
                <tbody>
                  {results.customers.map((c) => (
                    <tr key={c._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${c.customerReferenceNumber}`)}>
                      <td><span className="tid">{c.customerReferenceNumber}</span></td>
                      <td>
                        <div className="strong">{c.name}</div>
                        <div className="small muted truncate" title={c.address}>{c.address}</div>
                      </td>
                      <td><Badge tone="outline">{c.type}</Badge></td>
                      <td className="nowrap">{c.connectedFrom}</td>
                      <td className="mono nowrap">{c.contactNumber}</td>
                      <td className="small mono">
                        {c.vlan ? `VLAN ${c.vlan}` : '—'} · {c.sourcePort || '—'} → {c.destinationPort || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            <Section title="Tickets" count={results.tickets.length}>
              <table className="table">
                <thead><tr><th>TID</th><th>Customer</th><th>Issue</th><th>Priority</th><th>Status</th><th>Created</th><th>Assigned To</th></tr></thead>
                <tbody>
                  {results.tickets.map((t) => (
                    <tr key={t._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tickets/${t.ticketNumber}`)}>
                      <td><span className="tid">{t.ticketNumber}</span></td>
                      <td>
                        <div className="strong">{t.customerName}</div>
                        <div className="small muted">{t.customerReferenceNumber}</div>
                      </td>
                      <td className="nowrap">{t.issueType}</td>
                      <td><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                      <td><Badge tone={STATUS_TONE[t.status]} dot>{t.status}</Badge></td>
                      <td className="nowrap small">{formatDateTime(t.createdAt)}</td>
                      <td className="nowrap">{t.assignedToName || <span className="muted">Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {canViewInvoices ? (
              <Section title="Invoices" count={results.invoices.length}>
                <table className="table">
                  <thead><tr><th>Invoice #</th><th>TID</th><th>Customer</th><th>Status</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {results.invoices.map((i) => (
                      <tr key={i._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${i._id}`)}>
                        <td className="mono strong">{i.invoiceNumber}</td>
                        <td><span className="tid">{i.ticketNumber}</span></td>
                        <td>{i.customerName}</td>
                        <td><Badge tone={INVOICE_TONE[i.status]}>{i.status}</Badge></td>
                        <td className="text-right num strong">{formatMoney(i.total, i.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            ) : null}

            {canViewNetwork ? (
              <>
                <Section title="Network connections" count={network.connections?.length || 0}>
                  <table className="table">
                    <thead><tr><th>Label</th><th>Source</th><th>Destination</th><th>VLAN</th><th>Type</th><th>Customer</th></tr></thead>
                    <tbody>
                      {network.connections?.map((c) => (
                        <tr key={c._id}>
                          <td>{c.label || '—'}</td>
                          <td className="mono">{c.sourceDeviceName} <span className="muted">{c.sourcePort}</span></td>
                          <td className="mono">{c.destinationDeviceName} <span className="muted">{c.destinationPort}</span></td>
                          <td className="mono">{c.vlan || '—'}</td>
                          <td>{c.connectionType}</td>
                          <td className="mono">{c.customerReferenceNumber || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title="Network devices" count={network.devices?.length || 0}>
                  <table className="table">
                    <thead><tr><th>Name</th><th>Type</th><th>POP</th><th>Model</th><th>Management IP</th></tr></thead>
                    <tbody>
                      {network.devices?.map((d) => (
                        <tr key={d._id}>
                          <td className="strong">{d.name}</td>
                          <td><Badge tone="outline">{d.deviceType}</Badge></td>
                          <td>{d.popName || '—'}</td>
                          <td>{d.model || '—'}</td>
                          <td className="mono">{d.managementIp || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title="POPs" count={network.pops?.length || 0}>
                  <table className="table">
                    <thead><tr><th>Code</th><th>Name</th><th>Address</th></tr></thead>
                    <tbody>
                      {network.pops?.map((p) => (
                        <tr key={p._id}><td className="mono strong">{p.code}</td><td>{p.name}</td><td className="small">{p.address || '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Section>

                <Section title="VLANs" count={network.vlans?.length || 0}>
                  <table className="table">
                    <thead><tr><th>VLAN ID</th><th>Name</th><th>Description</th><th>Subnet</th></tr></thead>
                    <tbody>
                      {network.vlans?.map((v) => (
                        <tr key={v._id}>
                          <td className="mono strong">{v.vlanId}</td><td>{v.name}</td>
                          <td className="small">{v.description || '—'}</td><td className="mono small">{v.subnet || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              </>
            ) : null}
          </div>
        )
      ) : null}

      {!loading && !results && !error ? (
        <EmptyState icon="🔍" title="Search the whole system" message="Enter a customer reference, name, TID, VLAN, port or POP above." />
      ) : null}
    </>
  );
}

function Section({ title, count, children }) {
  if (!count) return null;
  return (
    <div className="card">
      <div className="card__head">
        <h2>{title}</h2>
        <div className="card__head-actions"><Badge tone="neutral">{count}</Badge></div>
      </div>
      <div className="card__body card__body--flush">
        <div className="table-wrap">{children}</div>
      </div>
    </div>
  );
}
