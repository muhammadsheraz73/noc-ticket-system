import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import CustomerFormModal from './CustomerFormModal.jsx';
import Countdown from '../components/Countdown.jsx';
import { Alert, Badge, DefItem, EmptyState, Loading, Stat, Tabs } from '../components/ui.jsx';
import {
  STATUS_TONE, PRIORITY_TONE, INVOICE_TONE, formatDate, formatDateTime, formatMoney, formatNumber,
} from '../utils/format.js';

/**
 * The complete internal record for one customer:
 * master data, network data, ticket history and invoice history.
 */
export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canManageTickets, canViewInvoices } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tickets');
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get(`/customers/${id}`);
      setData(response.data);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading label="Loading customer…" />;
  if (error) return <Alert tone="error" title="Customer not found">{error}</Alert>;

  const { customer, tickets, invoices, connections, stats } = data;

  return (
    <>
      <PageHead
        back="/customers"
        title={`${customer.customerReferenceNumber} — ${customer.name}`}
        subtitle={`${customer.type} · Connected from ${customer.connectedFrom}`}
        actions={
          <>
            {canManageTickets ? (
              <button className="btn btn--secondary" onClick={() => setEditOpen(true)}>✎ Edit</button>
            ) : null}
            {canManageTickets ? (
              <Link className="btn" to={`/tickets/new?customer=${customer.customerReferenceNumber}`}>
                ＋ Create Ticket
              </Link>
            ) : null}
          </>
        }
      />

      {customer.isDeleted ? (
        <Alert tone="warn" title="Archived customer">
          This customer has been soft deleted and cannot receive new tickets.
        </Alert>
      ) : null}

      <div className="stack">
        <div className="grid grid--stats">
          <Stat label="Total Tickets" value={formatNumber(stats.totalTickets)} />
          <Stat label="Open Tickets" value={formatNumber(stats.openTickets)} tone={stats.openTickets ? 'warn' : 'ok'} />
          <Stat label="Invoices" value={formatNumber(stats.totalInvoices)} tone="purple" />
          <Stat label="Billed Total" value={formatMoney(stats.billedTotal)} tone="ok" hint={`${stats.unpaidInvoices} unpaid`} />
        </div>

        <div className="grid grid--2">
          <div className="card">
            <div className="card__head"><h2>Customer information</h2></div>
            <div className="card__body">
              <div className="deflist">
                <DefItem label="Customer ID" value={customer.customerReferenceNumber} mono />
                <DefItem label="Name" value={customer.name} />
                <DefItem label="Type" ><Badge tone="outline">{customer.type}</Badge></DefItem>
                <DefItem label="Contact" value={customer.contactNumber} mono />
                <DefItem label="Connected From" value={customer.connectedFrom} />
                <DefItem label="Location">
                  {customer.location ? (
                    <a href={customer.location} target="_blank" rel="noreferrer">Open in Maps ↗</a>
                  ) : <span className="muted">—</span>}
                </DefItem>
                <DefItem label="Address" value={customer.address} />
                <DefItem label="Added" value={formatDate(customer.createdAt)} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Network information</h2>
              <div className="card__head-actions"><Badge tone="purple">Internal</Badge></div>
            </div>
            <div className="card__body">
              <div className="deflist">
                <DefItem label="Source Port" value={customer.sourcePort} mono />
                <DefItem label="Destination Port" value={customer.destinationPort} mono />
                <DefItem label="VLAN" value={customer.vlan} mono />
                <DefItem label="Notes" value={customer.notes} />
              </div>

              {connections?.length ? (
                <>
                  <div className="deflist__label" style={{ marginTop: 16, marginBottom: 8 }}>Linked connections</div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr><th>Source</th><th>Destination</th><th>VLAN</th><th>Type</th><th>SFP</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {connections.map((c) => (
                          <tr key={c._id}>
                            <td className="mono">{c.sourceDeviceName} <span className="muted">{c.sourcePort}</span></td>
                            <td className="mono">{c.destinationDeviceName} <span className="muted">{c.destinationPort}</span></td>
                            <td className="mono">{c.vlan || '—'}</td>
                            <td>{c.connectionType}</td>
                            <td className="small mono">{[c.sfpSpeed, c.sfpType].filter(Boolean).join(' ') || '—'}</td>
                            <td><Badge tone={c.status === 'Active' ? 'ok' : 'warn'}>{c.status}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <Alert tone="info" title="Visibility rule">
                Address, PUM/PMB/COR type, ports and VLAN are searchable here but are never printed on a generated ticket.
              </Alert>
            </div>
          </div>
        </div>

        <div className="card">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'tickets', label: 'Ticket history', count: tickets.length },
              ...(canViewInvoices ? [{ key: 'invoices', label: 'Invoice history', count: invoices.length }] : []),
            ]}
          />

          <div className="card__body card__body--flush">
            {tab === 'tickets' ? (
              tickets.length === 0 ? (
                <EmptyState icon="🎫" title="No tickets for this customer" />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>TID</th><th>Issue</th><th>Priority</th><th>Status</th>
                        <th>Created</th><th>ETTR</th><th>Time Left</th><th>Assigned To</th><th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((ticket) => (
                        <tr key={ticket._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/tickets/${ticket.ticketNumber}`)}>
                          <td><span className="tid">{ticket.ticketNumber}</span></td>
                          <td className="nowrap">{ticket.issueType}</td>
                          <td><Badge tone={PRIORITY_TONE[ticket.priority]}>{ticket.priority}</Badge></td>
                          <td><Badge tone={STATUS_TONE[ticket.status]} dot>{ticket.status}</Badge></td>
                          <td className="nowrap small">{formatDateTime(ticket.createdAt)}</td>
                          <td className="nowrap small">{formatDateTime(ticket.ettrAt)}</td>
                          <td className="nowrap">
                            <Countdown ettrAt={ticket.ettrAt} frozen={ticket.timeLeft?.frozen} frozenAt={ticket.resolvedAt} short />
                          </td>
                          <td className="nowrap">{ticket.assignedToName || <span className="muted">Unassigned</span>}</td>
                          <td><span className="truncate small" title={ticket.remarks}>{ticket.remarks || '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : invoices.length === 0 ? (
              <EmptyState icon="🧾" title="No invoices for this customer" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Invoice #</th><th>Ticket</th><th>Issue Date</th><th>Due Date</th><th>Status</th><th className="text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice._id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${invoice._id}`)}>
                        <td className="mono strong">{invoice.invoiceNumber}</td>
                        <td><span className="tid">{invoice.ticketNumber}</span></td>
                        <td className="nowrap small">{formatDate(invoice.issueDate)}</td>
                        <td className="nowrap small">{formatDate(invoice.dueDate)}</td>
                        <td><Badge tone={INVOICE_TONE[invoice.status]}>{invoice.status}</Badge></td>
                        <td className="text-right num strong">{formatMoney(invoice.total, invoice.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <CustomerFormModal
        open={editOpen}
        customer={customer}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); load(); }}
      />
    </>
  );
}
