import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../api/client.js';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, EmptyState, Field, Loading, Tabs, TextInput } from '../components/ui.jsx';

const TABS = [
  { key: 'devices', label: 'Devices', path: '/network/devices' },
  { key: 'connections', label: 'Connections', path: '/network/connections' },
  { key: 'pops', label: 'POPs', path: '/network/pops' },
  { key: 'vlans', label: 'VLANs', path: '/network/vlans' },
];

/** Internal network inventory — searchable, never printed on a generated ticket. */
export default function NetworkPage() {
  const [tab, setTab] = useState('devices');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const path = TABS.find((t) => t.key === tab).path;
      const { data } = await api.get(path, { params: { q: query || undefined } });
      setItems(data.items);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 320 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <>
      <PageHead
        title="Network inventory"
        subtitle="POPs, OLTs, switches, ports, VLANs and connections — internal data only."
      />

      {error ? <Alert tone="error" title="Could not load inventory">{error}</Alert> : null}

      <div className="card">
        <Tabs tabs={TABS} active={tab} onChange={(key) => { setTab(key); setItems([]); }} />

        <div className="filters">
          <div className="filters__item filters__item--grow">
            <Field label="Search">
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Device name, port, VLAN, IP, POP code…"
              />
            </Field>
          </div>
        </div>

        <div className="card__body card__body--flush">
          {loading ? (
            <Loading label="Loading inventory…" />
          ) : items.length === 0 ? (
            <EmptyState icon="🖧" title="No records found" message="Nothing matches this search." />
          ) : (
            <div className="table-wrap">
              {tab === 'devices' ? <DeviceTable items={items} /> : null}
              {tab === 'connections' ? <ConnectionTable items={items} /> : null}
              {tab === 'pops' ? <PopTable items={items} /> : null}
              {tab === 'vlans' ? <VlanTable items={items} /> : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DeviceTable({ items }) {
  return (
    <table className="table">
      <thead><tr><th>Name</th><th>Type</th><th>POP</th><th>Vendor / Model</th><th>Management IP</th><th>Ports</th></tr></thead>
      <tbody>
        {items.map((d) => (
          <tr key={d._id}>
            <td className="strong">{d.name}</td>
            <td><Badge tone="outline">{d.deviceType}</Badge></td>
            <td>{d.pop?.name || d.popName || '—'}</td>
            <td>{[d.vendor, d.model].filter(Boolean).join(' ') || '—'}</td>
            <td className="mono">{d.managementIp || '—'}</td>
            <td className="small mono">
              {d.ports?.length
                ? d.ports.map((p) => `${p.name} (${p.status})`).join(', ')
                : <span className="muted">none recorded</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConnectionTable({ items }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Label</th><th>Source</th><th>Destination</th><th>VLAN</th><th>Type</th><th>SFP</th><th>Customer</th><th>Status</th></tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <tr key={c._id}>
            <td>{c.label || '—'}</td>
            <td className="mono">{c.sourceDeviceName || '—'} <span className="muted">{c.sourcePort}</span></td>
            <td className="mono">{c.destinationDeviceName || '—'} <span className="muted">{c.destinationPort}</span></td>
            <td className="mono">{c.vlan || '—'}</td>
            <td>{c.connectionType}</td>
            <td className="small mono">{[c.sfpSpeed, c.sfpType].filter(Boolean).join(' ') || '—'}</td>
            <td className="mono">{c.customerReferenceNumber || '—'}</td>
            <td><Badge tone={c.status === 'Active' ? 'ok' : 'warn'}>{c.status}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PopTable({ items }) {
  return (
    <table className="table">
      <thead><tr><th>Code</th><th>Name</th><th>Address</th><th>Status</th></tr></thead>
      <tbody>
        {items.map((p) => (
          <tr key={p._id}>
            <td className="mono strong">{p.code}</td>
            <td>{p.name}</td>
            <td className="small">{p.address || '—'}</td>
            <td><Badge tone={p.isActive ? 'ok' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VlanTable({ items }) {
  return (
    <table className="table">
      <thead><tr><th>VLAN ID</th><th>Name</th><th>Description</th><th>Subnet</th><th>POP</th></tr></thead>
      <tbody>
        {items.map((v) => (
          <tr key={v._id}>
            <td className="mono strong">{v.vlanId}</td>
            <td>{v.name}</td>
            <td className="small">{v.description || '—'}</td>
            <td className="mono small">{v.subnet || '—'}</td>
            <td>{v.popName || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
