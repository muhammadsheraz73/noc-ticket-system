import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * One search box across customers, tickets, invoices and network inventory.
 * Handles the spec's examples: 10255, Abdul Rouf, 613, 4626, Gajjumata, GE0/0/1.
 */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const { canViewInvoices } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 1) {
      setResults(null);
      return undefined;
    }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/search', {
          params: { q: term, limit: 5 },
          signal: controller.signal,
        });
        setResults(data);
      } catch (error) {
        if (error.name !== 'CanceledError') setResults(null);
      } finally {
        setLoading(false);
      }
    }, 260);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const go = (path) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  const submit = (event) => {
    event.preventDefault();
    const term = query.trim();
    if (term) go(`/search?q=${encodeURIComponent(term)}`);
  };

  const network = results?.network || {};
  const networkCount =
    (network.connections?.length || 0) +
    (network.devices?.length || 0) +
    (network.pops?.length || 0) +
    (network.vlans?.length || 0);

  return (
    <div className="gsearch" ref={boxRef}>
      <form onSubmit={submit}>
        <Search className="gsearch__icon" aria-hidden="true" />
        <input
          className="gsearch__input"
          placeholder="Search customer ID, name, TID, VLAN, port, POP…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-label="Global search"
        />
      </form>

      {open && query.trim() ? (
        <div className="gsearch__panel">
          {loading && !results ? <div className="gsearch__foot muted">Searching…</div> : null}

          {results?.customers?.length ? (
            <>
              <div className="gsearch__group-label">Customers</div>
              {results.customers.map((c) => (
                <button
                  key={c._id}
                  className="gsearch__item"
                  style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: 'pointer' }}
                  onClick={() => go(`/customers/${c.customerReferenceNumber}`)}
                >
                  <div className="gsearch__item-title">
                    {c.customerReferenceNumber} — {c.name}
                  </div>
                  <div className="gsearch__item-sub">
                    {c.type} · {c.connectedFrom} · {c.contactNumber}
                    {c.vlan ? ` · VLAN ${c.vlan}` : ''}
                  </div>
                </button>
              ))}
            </>
          ) : null}

          {results?.tickets?.length ? (
            <>
              <div className="gsearch__group-label">Tickets</div>
              {results.tickets.map((t) => (
                <button
                  key={t._id}
                  className="gsearch__item"
                  style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: 'pointer' }}
                  onClick={() => go(`/tickets/${t.ticketNumber}`)}
                >
                  <div className="gsearch__item-title">
                    TID {t.ticketNumber} — {t.issueType}
                  </div>
                  <div className="gsearch__item-sub">
                    {t.customerReferenceNumber} · {t.customerName} · {t.status} · {t.priority}
                  </div>
                </button>
              ))}
            </>
          ) : null}

          {canViewInvoices && results?.invoices?.length ? (
            <>
              <div className="gsearch__group-label">Invoices</div>
              {results.invoices.map((i) => (
                <button
                  key={i._id}
                  className="gsearch__item"
                  style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: 'pointer' }}
                  onClick={() => go(`/invoices/${i._id}`)}
                >
                  <div className="gsearch__item-title">{i.invoiceNumber}</div>
                  <div className="gsearch__item-sub">
                    TID {i.ticketNumber} · {i.customerName} · {i.status}
                  </div>
                </button>
              ))}
            </>
          ) : null}

          {networkCount > 0 ? (
            <>
              <div className="gsearch__group-label">Network inventory</div>
              <button
                className="gsearch__item"
                style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: 'pointer' }}
                onClick={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}
              >
                <div className="gsearch__item-title">{networkCount} network record(s) matched</div>
                <div className="gsearch__item-sub">Devices, connections, POPs and VLANs</div>
              </button>
            </>
          ) : null}

          {results && results.total === 0 && !loading ? (
            <div className="gsearch__foot muted">No results for “{query.trim()}”</div>
          ) : null}

          {results && results.total > 0 ? (
            <div className="gsearch__foot">
              <button className="btn btn--ghost btn--sm" onClick={submit}>
                View all {results.total} results →
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
