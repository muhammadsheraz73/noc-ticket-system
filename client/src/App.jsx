import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, ROLES } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Loading, EmptyState } from './components/ui.jsx';

import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import CustomersPage from './pages/CustomersPage.jsx';
import CustomerDetailPage from './pages/CustomerDetailPage.jsx';
import ImportCustomersPage from './pages/ImportCustomersPage.jsx';
import TicketsPage from './pages/TicketsPage.jsx';
import CreateTicketPage from './pages/CreateTicketPage.jsx';
import TicketDetailPage from './pages/TicketDetailPage.jsx';
import InvoicesPage from './pages/InvoicesPage.jsx';
import CreateInvoicePage from './pages/CreateInvoicePage.jsx';
import InvoiceDetailPage from './pages/InvoiceDetailPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import NetworkPage from './pages/NetworkPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

/** Blocks unauthenticated access and, optionally, disallowed roles. */
function Protected({ roles, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <Loading label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (roles && !roles.includes(user.role)) {
    return (
      <EmptyState
        icon="🔒"
        title="You do not have access to this page"
        message={`This section is restricted. Your role is "${user.role}".`}
      />
    );
  }
  return children;
}

export default function App() {
  const { user, ready } = useAuth();

  if (!ready) return <Loading label="Starting NOC Manager…" />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route
          path="customers"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.ACCOUNTS]}>
              <CustomersPage />
            </Protected>
          }
        />
        <Route
          path="customers/import"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <ImportCustomersPage />
            </Protected>
          }
        />
        <Route
          path="customers/:id"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.ACCOUNTS]}>
              <CustomerDetailPage />
            </Protected>
          }
        />

        <Route path="tickets" element={<TicketsPage />} />
        <Route
          path="tickets/new"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <CreateTicketPage />
            </Protected>
          }
        />
        <Route path="tickets/:id" element={<TicketDetailPage />} />

        <Route
          path="invoices"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <InvoicesPage />
            </Protected>
          }
        />
        <Route
          path="invoices/new"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <CreateInvoicePage />
            </Protected>
          }
        />
        <Route
          path="invoices/:id"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <InvoiceDetailPage />
            </Protected>
          }
        />

        <Route path="search" element={<SearchPage />} />
        <Route
          path="network"
          element={
            <Protected roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <NetworkPage />
            </Protected>
          }
        />
        <Route
          path="users"
          element={
            <Protected roles={[ROLES.ADMIN]}>
              <UsersPage />
            </Protected>
          }
        />
        <Route path="settings" element={<SettingsPage />} />

        <Route
          path="*"
          element={
            <EmptyState icon="🧭" title="Page not found" message="The page you asked for does not exist." />
          }
        />
      </Route>
    </Routes>
  );
}
