import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, ROLES } from '../context/AuthContext.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import { initials, ROLE_LABELS, formatDateTime } from '../utils/format.js';

const NAV = [
  {
    group: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', icon: '▤', end: true },
      { to: '/tickets', label: 'Tickets', icon: '🎫' },
      { to: '/tickets/new', label: 'Create Ticket', icon: '＋', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
      { to: '/customers', label: 'Customers', icon: '👥', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.ACCOUNTS] },
      { to: '/field-teams', label: 'Field Team', icon: '🔧' },
    ],
  },
  {
    group: 'Billing',
    items: [
      { to: '/invoices', label: 'Invoices', icon: '🧾', roles: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR] },
      { to: '/invoices/new', label: 'Create Invoice', icon: '＋', roles: [ROLES.ADMIN, ROLES.ACCOUNTS] },
    ],
  },
  {
    group: 'Internal',
    items: [
      { to: '/network', label: 'Network Inventory', icon: '🖧', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
      { to: '/customers/import', label: 'Import Excel', icon: '⭳', roles: [ROLES.ADMIN, ROLES.NOC_OPERATOR] },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: '🛡', roles: [ROLES.ADMIN] },
      { to: '/settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

export default function Layout() {
  const { user, logout, serverNow } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState(() => serverNow());
  const menuRef = useRef(null);

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  useEffect(() => {
    const id = setInterval(() => setClock(serverNow()), 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(user?.role)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="app-shell">
      <aside className={`sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="sidebar__brand">
          <div className="sidebar__logo">NOC</div>
          <div>
            <div className="sidebar__title">NOC Manager</div>
            <div className="sidebar__subtitle">Ticket &amp; Network</div>
          </div>
        </div>

        <nav className="sidebar__nav">
          {visibleGroups.map((group) => (
            <div className="sidebar__group" key={group.group}>
              <div className="sidebar__group-label">{group.group}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
                >
                  <span className="sidebar__icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          Signed in as <strong style={{ color: '#fff' }}>{ROLE_LABELS[user?.role]}</strong>
        </div>
      </aside>

      {sidebarOpen ? <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="main">
        <header className="topbar">
          <button
            className="topbar__toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>

          <GlobalSearch />
          <div className="topbar__spacer" />
          <div className="topbar__clock">{formatDateTime(clock)}</div>

          <div className="usermenu" ref={menuRef}>
            <button className="usermenu__btn" onClick={() => setMenuOpen((open) => !open)}>
              <span className="avatar">{initials(user?.name)}</span>
              <span>
                <span className="usermenu__name">{user?.name}</span>
                <br />
                <span className="usermenu__role">{ROLE_LABELS[user?.role]}</span>
              </span>
            </button>

            {menuOpen ? (
              <div className="usermenu__panel">
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
                  <div className="strong">{user?.name}</div>
                  <div className="small muted">{user?.email}</div>
                </div>
                <button
                  className="usermenu__item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/settings');
                  }}
                >
                  ⚙ Settings &amp; password
                </button>
                <button
                  className="usermenu__item usermenu__item--danger"
                  onClick={async () => {
                    setMenuOpen(false);
                    await logout();
                    navigate('/login');
                  }}
                >
                  ⏻ Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Reusable page header with title, subtitle and actions. */
export function PageHead({ title, subtitle, actions, back }) {
  const navigate = useNavigate();
  return (
    <div className="page-head">
      {back ? (
        <button className="btn btn--secondary btn--icon" onClick={() => navigate(back)} aria-label="Back">
          ←
        </button>
      ) : null}
      <div className="page-head__text">
        <h1>{title}</h1>
        {subtitle ? <div className="page-head__sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </div>
  );
}
