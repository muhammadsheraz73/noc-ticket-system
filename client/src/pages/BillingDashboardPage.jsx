import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Banknote, ChartColumn, ChevronRight, Coins, FileText, Plus, Receipt, Table2, TriangleAlert, Wallet,
} from 'lucide-react';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import Kpi from '../components/Kpi.jsx';
import CountUp from '../components/CountUp.jsx';
import { Alert, Badge, EmptyState, TableSkeleton } from '../components/ui.jsx';
import {
  INVOICE_TONE, QUOTATION_TONE, formatDate, formatDateTime, formatMoney, formatNumber, relativeTime,
} from '../utils/format.js';
import '../styles/billing-dashboard.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BILL_STATUS = [
  { key: 'Received', tone: 'ok', label: 'Paid' },
  { key: 'Partial', tone: 'warn', label: 'Partial' },
  { key: 'Pending', tone: 'danger', label: 'Unpaid' },
];

/** "2026-10" → "Oct" / "October 2026". */
const monthShort = (period) => MONTHS[Number(period.slice(5, 7)) - 1];
const monthLong = (period) => new Date(`${period}-15`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
/** Whole rupees for headline numbers — paisa only adds noise on a dashboard. */
const whole = (value) => Math.round(Number(value || 0)).toLocaleString('en-US');
/** Axis labels: 1.2M, 350K, 900. */
const compact = (value) => {
  const n = Number(value || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
};
const plural = (n, word) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
const rate = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** The billing team's home screen: this month's money, what is owed, and what needs doing. */
export default function BillingDashboardPage() {
  const { user, serverNow } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await api.get('/billing/dashboard');
      setData(response.data);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  if (error && !data) return <Alert tone="error" title="Dashboard unavailable">{error}</Alert>;
  if (!data) return <DashboardSkeleton />;

  const m = data.thisMonth;
  const last = data.lastMonth;
  const collectedRate = rate(m.received, m.fee);
  const change = last.fee > 0 ? Math.round(((m.fee - last.fee) / last.fee) * 100) : null;
  const hour = serverNow().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  return (
    <>
      <PageHead
        title={`Good ${greeting}, ${user.name.split(' ')[0]}`}
        subtitle={`${user.tenantName ? `${user.tenantName} · ` : ''}Billing overview for ${monthLong(data.period)}`}
        actions={(
          <button className="btn" onClick={() => navigate('/billing')}>
            <Wallet size={15} /> Monthly bills
          </button>
        )}
      />

      <div className="stack">
        <div className="kpi-row">
          <Kpi
            icon={Receipt}
            tone="brand"
            label={`Billed · ${monthShort(data.period)}`}
            prefix="PKR"
            value={whole(m.fee)}
            hint={change === null
              ? `${formatNumber(m.count)} bills this month`
              : `${formatNumber(m.count)} bills · ${change === 0 ? 'same as' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% vs`} ${monthShort(last.period)}`}
            onClick={() => navigate('/billing')}
          />
          <Kpi
            icon={Banknote}
            tone="ok"
            label="Collected"
            prefix="PKR"
            value={whole(m.received)}
            hint={`${collectedRate}% of this month's bills`}
          />
          <Kpi
            icon={TriangleAlert}
            tone="danger"
            label="Outstanding dues"
            prefix="PKR"
            value={whole(data.dues.amount)}
            hint={`${formatNumber(data.dues.users)} users · ${formatNumber(data.dues.bills)} unpaid bills`}
          />
          <Kpi
            icon={Coins}
            tone="info"
            label="Received today"
            prefix="PKR"
            value={whole(data.collectedToday.amount)}
            hint={`${plural(data.collectedToday.count, 'payment')} · PKR ${whole(data.collectedThisMonth.amount)} this month`}
          />
        </div>

        <div className="bd-grid bd-grid--wide">
          <CollectionsChart trend={data.trend} />
          <MonthHealth month={m} rateValue={collectedRate} />
        </div>

        <div className="bd-grid">
          <Defaulters rows={data.defaulters} />
          <RecentPayments rows={data.recentPayments} now={serverNow()} />
        </div>

        <div className="bd-grid">
          <InvoicesCard summary={data.invoices} recent={data.recentInvoices} />
          <QuotationsCard summary={data.quotations} recent={data.recentQuotations} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- the chart */

/** Billed vs collected for the last six months; hover a month for exact figures, or switch to the table. */
function CollectionsChart({ trend }) {
  const [view, setView] = useState('chart');
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...trend.map((t) => Math.max(t.fee, t.received)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const empty = trend.every((t) => !t.fee && !t.received);

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>Collections</h2>
          <div className="small muted">Billed vs collected, last 6 months</div>
        </div>
        <div className="card__head-actions">
          <div className="seg" role="group" aria-label="Show as">
            <button className={`seg__btn${view === 'chart' ? ' is-active' : ''}`} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
              <ChartColumn size={14} /> Chart
            </button>
            <button className={`seg__btn${view === 'table' ? ' is-active' : ''}`} aria-pressed={view === 'table'} onClick={() => setView('table')}>
              <Table2 size={14} /> Table
            </button>
          </div>
        </div>
      </div>
      <div className="card__body">
        {empty ? (
          <EmptyState icon="📊" title="No bills yet" message="Generate this month's bills and the trend will appear here." />
        ) : view === 'table' ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th><th className="text-right">Billed</th><th className="text-right">Collected</th>
                  <th className="text-right">Dues</th><th className="text-right">Collected %</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((t) => (
                  <tr key={t.period}>
                    <td className="strong">{monthLong(t.period)}</td>
                    <td className="text-right num">{formatMoney(t.fee)}</td>
                    <td className="text-right num">{formatMoney(t.received)}</td>
                    <td className="text-right num">{formatMoney(t.arrears)}</td>
                    <td className="text-right num">{rate(t.received, t.fee)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="bd-legend" aria-hidden="true">
              <span><i className="bd-swatch bd-swatch--billed" /> Billed</span>
              <span><i className="bd-swatch bd-swatch--collected" /> Collected</span>
            </div>
            <div className="bd-chart" role="img" aria-label={`Billed vs collected: ${trend.map((t) => `${monthShort(t.period)} billed ${whole(t.fee)}, collected ${whole(t.received)}`).join('; ')}`}>
              <div className="bd-chart__axis">
                {ticks.slice().reverse().map((tick) => <span key={tick}>{compact(tick)}</span>)}
              </div>
              <div className="bd-chart__plot">
                <div className="bd-chart__grid">
                  {ticks.map((tick) => <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }} />)}
                </div>
                {trend.map((t, i) => (
                  <div
                    key={t.period}
                    className={`bd-chart__group${hover === i ? ' is-hover' : ''}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                  >
                    <div className="bd-chart__bars">
                      <span className="bd-bar bd-bar--billed" style={{ height: `${(t.fee / top) * 100}%` }} />
                      <span className="bd-bar bd-bar--collected" style={{ height: `${(t.received / top) * 100}%` }} />
                    </div>
                    <span className="bd-chart__label">{monthShort(t.period)}</span>
                  </div>
                ))}
                {hover !== null ? <ChartTip t={trend[hover]} at={((hover + 0.5) / trend.length) * 100} /> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Hover card, anchored over the month and slid left by the same share, so the
 * first month's card starts at the plot's left edge and the last month's ends
 * at its right edge — it never spills out of the card, even on a phone.
 */
function ChartTip({ t, at }) {
  return (
    <div className="bd-tip" role="tooltip" style={{ left: `${at}%`, transform: `translateX(-${at}%)` }}>
      <div className="bd-tip__title">{monthLong(t.period)}</div>
      <div className="bd-tip__row"><i className="bd-swatch bd-swatch--billed" /> Billed <b>{formatMoney(t.fee)}</b></div>
      <div className="bd-tip__row"><i className="bd-swatch bd-swatch--collected" /> Collected <b>{formatMoney(t.received)}</b></div>
      <div className="bd-tip__row bd-tip__row--muted">Dues <b>{formatMoney(t.arrears)}</b></div>
      <div className="bd-tip__row bd-tip__row--muted">{rate(t.received, t.fee)}% collected · {t.count} bills</div>
    </div>
  );
}

/** Round axis steps (0, 50K, 100K, …) that cover `max` in four or five lines. */
function niceTicks(max) {
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/* ------------------------------------------------- this month at a glance */

function MonthHealth({ month, rateValue }) {
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>{monthLong(month.period)}</h2>
          <div className="small muted">Collection progress</div>
        </div>
      </div>
      <div className="card__body">
        <div className="bd-hero">
          <span className="bd-hero__value"><CountUp value={`${rateValue}%`} /></span>
          <span className="bd-hero__label">collected</span>
        </div>
        <div className="bd-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, rateValue)}%` }} /></div>
        <div className="bd-meter__caption small muted">
          PKR {whole(month.received)} of PKR {whole(month.fee)} · PKR {whole(month.arrears)} still due
        </div>

        <div className="bd-split" aria-label="Bills by payment status">
          {month.count > 0 ? (
            <div className="bd-split__bar" aria-hidden="true">
              {BILL_STATUS.map((s) => (month.byStatus[s.key] ? (
                <span key={s.key} className={`bd-split__seg bd-split__seg--${s.tone}`} style={{ flexGrow: month.byStatus[s.key] }} />
              ) : null))}
            </div>
          ) : null}
          <ul className="bd-split__legend">
            {BILL_STATUS.map((s) => (
              <li key={s.key}>
                <span className={`bd-dot bd-dot--${s.tone}`} />
                <span>{s.label}</span>
                <b>{formatNumber(month.byStatus[s.key])}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="bd-actions">
          <Link className="btn btn--sm" to="/billing"><Plus size={14} /> Generate bills</Link>
          <Link className="btn btn--secondary btn--sm" to="/invoices/new"><Receipt size={14} /> New invoice</Link>
          <Link className="btn btn--secondary btn--sm" to="/quotations/new"><FileText size={14} /> New quotation</Link>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- who owes / who paid */

function Defaulters({ rows }) {
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>Top outstanding</h2>
          <div className="small muted">Users with the most unpaid dues, all months</div>
        </div>
        <div className="card__head-actions">
          <Link className="btn btn--ghost btn--sm" to="/billing">Billing <ChevronRight size={14} /></Link>
        </div>
      </div>
      <div className="card__body card__body--flush">
        {rows.length === 0 ? (
          <EmptyState icon="🎉" title="No dues" message="Every bill is fully paid." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>User</th><th>Unpaid months</th><th className="text-right">Dues</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.subscriber}>
                    <td>
                      <div className="strong">{r.username}</div>
                      {r.address ? <div className="small muted bd-ellipsis">{r.address}</div> : null}
                    </td>
                    <td className="small">
                      {r.months} {r.months === 1 ? 'month' : 'months'}
                      <div className="muted">since {monthLong(r.oldest)}</div>
                    </td>
                    <td className="text-right num strong text-danger">{formatMoney(r.arrears)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentPayments({ rows, now }) {
  return (
    <div className="card">
      <div className="card__head">
        <div>
          <h2>Recent payments</h2>
          <div className="small muted">Latest money received</div>
        </div>
      </div>
      <div className="card__body card__body--flush">
        {rows.length === 0 ? (
          <EmptyState icon="💸" title="No payments yet" message="Payments you receive on the Billing page show up here." />
        ) : (
          <ul className="bd-feed">
            {rows.map((p) => (
              <li key={p._id}>
                <span className="bd-feed__icon"><Banknote size={16} /></span>
                <div className="bd-feed__body">
                  <div className="strong bd-ellipsis">{p.username}</div>
                  <div className="small muted" title={formatDateTime(p.receivedAt)}>
                    {monthShort(p.period)} bill · {p.receivedBy ? `by ${p.receivedBy} · ` : ''}{relativeTime(p.receivedAt, now)}
                  </div>
                </div>
                <span className="num strong">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------- invoices and quotations */

function MiniStats({ items }) {
  return (
    <div className="bd-mini">
      {items.map((item) => (
        <div key={item.label} className={`bd-mini__item${item.tone ? ` bd-mini__item--${item.tone}` : ''}`}>
          <span className="bd-mini__label">{item.label}</span>
          <span className="bd-mini__value">{item.value}</span>
          <span className="bd-mini__hint">{item.hint}</span>
        </div>
      ))}
    </div>
  );
}

function InvoicesCard({ summary, recent }) {
  const get = (key) => summary[key] || { amount: 0, count: 0 };
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="card__head">
        <h2>Invoices</h2>
        <div className="card__head-actions">
          <Link className="btn btn--ghost btn--sm" to="/invoices">View all <ChevronRight size={14} /></Link>
        </div>
      </div>
      <div className="card__body">
        <MiniStats
          items={[
            { label: 'Unpaid', value: `PKR ${whole(get('Unpaid').amount)}`, hint: `${get('Unpaid').count} invoices`, tone: 'warn' },
            { label: 'Overdue', value: `PKR ${whole(summary.overdue.amount)}`, hint: `${summary.overdue.count} past due date`, tone: 'danger' },
            { label: 'Paid', value: `PKR ${whole(get('Paid').amount)}`, hint: `${get('Paid').count} invoices`, tone: 'ok' },
          ]}
        />
      </div>
      <div className="card__body card__body--flush">
        {recent.length === 0 ? (
          <EmptyState icon="🧾" title="No invoices yet" message="Invoices you create appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {recent.map((inv) => (
                  <tr key={inv._id} className="bd-row-link" onClick={() => navigate(`/invoices/${inv._id}`)}>
                    <td>
                      <div className="strong mono">{inv.invoiceNumber}</div>
                      <div className="small muted bd-ellipsis">{inv.customerName}</div>
                    </td>
                    <td className="small muted nowrap bd-hide-sm">Due {formatDate(inv.dueDate)}</td>
                    <td><Badge tone={INVOICE_TONE[inv.status]}>{inv.status}</Badge></td>
                    <td className="text-right num nowrap">{formatMoney(inv.total, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function QuotationsCard({ summary, recent }) {
  const get = (key) => summary[key] || { amount: 0, count: 0 };
  const navigate = useNavigate();
  const decided = get('Accepted').count + get('Rejected').count;
  return (
    <div className="card">
      <div className="card__head">
        <h2>Quotations</h2>
        <div className="card__head-actions">
          <Link className="btn btn--ghost btn--sm" to="/quotations">View all <ChevronRight size={14} /></Link>
        </div>
      </div>
      <div className="card__body">
        <MiniStats
          items={[
            { label: 'Awaiting reply', value: `PKR ${whole(get('Sent').amount)}`, hint: `${get('Sent').count} sent`, tone: 'info' },
            { label: 'Accepted', value: `PKR ${whole(get('Accepted').amount)}`, hint: `${get('Accepted').count} won`, tone: 'ok' },
            { label: 'Win rate', value: `${rate(get('Accepted').count, decided)}%`, hint: `${get('Draft').count} drafts · ${get('Rejected').count} rejected` },
          ]}
        />
      </div>
      <div className="card__body card__body--flush">
        {recent.length === 0 ? (
          <EmptyState icon="📄" title="No quotations yet" message="Quotations you prepare appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {recent.map((q) => (
                  <tr key={q._id} className="bd-row-link" onClick={() => navigate(`/quotations/${q._id}`)}>
                    <td>
                      <div className="strong mono">{q.quoteNumber}</div>
                      <div className="small muted bd-ellipsis">{q.clientName}{q.subject ? ` · ${q.subject}` : ''}</div>
                    </td>
                    <td><Badge tone={QUOTATION_TONE[q.status]}>{q.status}</Badge></td>
                    <td className="text-right num nowrap">{formatMoney(q.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="stack">
      <div className="kpi-row">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="kpi bd-skeleton" />)}
      </div>
      <div className="card"><div className="card__body"><TableSkeleton rows={6} cols={5} /></div></div>
    </div>
  );
}
