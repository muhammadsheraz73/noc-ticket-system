import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
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
import InventoryPage from './pages/InventoryPage.jsx';
import EmployeesPage from './pages/EmployeesPage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import ClientDetailPage from './pages/ClientDetailPage.jsx';
import OwnerOverviewPage from './pages/OwnerOverviewPage.jsx';
import OwnerActivityPage from './pages/OwnerActivityPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import BillingPage from './pages/BillingPage.jsx';
import QuotationsPage from './pages/QuotationsPage.jsx';
import QuotationFormPage from './pages/QuotationFormPage.jsx';
import QuotationDetailPage from './pages/QuotationDetailPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import BillingDashboardPage from './pages/BillingDashboardPage.jsx';
import { MODULE_LABELS, firstOpenPath } from './utils/modules.js';

/** Everybody inside a client except its billing department (Accounts), whose panel is billing-only. */
const OPERATIONS = [ROLES.ADMIN, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER];

function Home({ role }) {
  const { user, isLocked } = useAuth();
  if (role === ROLES.SUPERADMIN) return <OwnerOverviewPage />;
  // Dashboard locked by the owner: start on the first page this login can open.
  if (isLocked('dashboard')) return <Navigate to={firstOpenPath(user)} replace />;
  if (role === ROLES.ACCOUNTS) return <BillingDashboardPage />;
  return <DashboardPage />;
}

/** Logins now live on each client's page; old links land on the right tab. */
function LoginsRedirect() {
  const [params] = useSearchParams();
  const client = params.get('client');
  return <Navigate to={client ? `/clients/${client}?tab=logins` : '/clients'} replace />;
}

/**
 * Blocks unauthenticated access and, optionally, disallowed roles.
 * The panel owner has no client data, so everywhere except the pages marked
 * `ownerOk` they are sent to the Clients page.
 */
function Protected({ roles, ownerOk, module, children }) {
  const { user, ready, isLocked } = useAuth();
  const location = useLocation();

  if (!ready) return <Loading label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role === ROLES.SUPERADMIN && !ownerOk) return <Navigate to="/clients" replace />;

  if (roles && !roles.includes(user.role)) {
    return (
      <EmptyState
        icon="🔒"
        title="You do not have access to this page"
        message={`This section is restricted. Your role is "${user.role}".`}
      />
    );
  }
  if (isLocked(module)) {
    return (
      <EmptyState
        icon="🔒"
        title={`${MODULE_LABELS[module]} is locked`}
        message="The panel owner has locked this feature for your account. Please contact them to unlock it."
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
          <Protected ownerOk>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Home role={user?.role} />} />

        <Route
          path="customers"
          element={
            <Protected module="customers" roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <CustomersPage />
            </Protected>
          }
        />
        <Route
          path="customers/import"
          element={
            <Protected module="import" roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <ImportCustomersPage />
            </Protected>
          }
        />
        <Route
          path="customers/:id"
          element={
            <Protected module="customers" roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <CustomerDetailPage />
            </Protected>
          }
        />

        <Route path="tickets" element={<Protected module="tickets" roles={OPERATIONS}><TicketsPage /></Protected>} />
        <Route
          path="tickets/new"
          element={
            <Protected module="tickets" roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <CreateTicketPage />
            </Protected>
          }
        />
        <Route path="tickets/:id" element={<Protected module="tickets" roles={OPERATIONS}><TicketDetailPage /></Protected>} />

        <Route
          path="invoices"
          element={
            <Protected module="invoices" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER]}>
              <InvoicesPage />
            </Protected>
          }
        />
        <Route
          path="invoices/new"
          element={
            <Protected module="invoices" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <CreateInvoicePage />
            </Protected>
          }
        />
        <Route
          path="invoices/:id"
          element={
            <Protected module="invoices" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER]}>
              <InvoiceDetailPage />
            </Protected>
          }
        />

        <Route
          path="quotations"
          element={
            <Protected module="quotations" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <QuotationsPage />
            </Protected>
          }
        />
        <Route
          path="quotations/new"
          element={
            <Protected module="quotations" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <QuotationFormPage />
            </Protected>
          }
        />
        <Route
          path="quotations/:id"
          element={
            <Protected module="quotations" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <QuotationDetailPage />
            </Protected>
          }
        />
        <Route
          path="quotations/:id/edit"
          element={
            <Protected module="quotations" roles={[ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR]}>
              <QuotationFormPage />
            </Protected>
          }
        />
        <Route
          path="billing"
          element={
            <Protected module="billing" roles={[ROLES.ACCOUNTS]}>
              <BillingPage />
            </Protected>
          }
        />
        <Route path="search" element={<Protected roles={OPERATIONS}><SearchPage /></Protected>} />
        <Route path="network" element={<Navigate to="/inventory" replace />} />
        <Route
          path="employees"
          element={
            <Protected module="employees" roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <EmployeesPage />
            </Protected>
          }
        />
        <Route
          path="inventory"
          element={
            <Protected module="inventory" roles={[ROLES.ADMIN, ROLES.NOC_OPERATOR]}>
              <InventoryPage />
            </Protected>
          }
        />
        <Route
          path="clients"
          element={
            <Protected ownerOk roles={[ROLES.SUPERADMIN]}>
              <ClientsPage />
            </Protected>
          }
        />
        <Route
          path="clients/:id"
          element={
            <Protected ownerOk roles={[ROLES.SUPERADMIN]}>
              <ClientDetailPage />
            </Protected>
          }
        />
        <Route
          path="activity"
          element={
            <Protected ownerOk roles={[ROLES.SUPERADMIN]}>
              <OwnerActivityPage />
            </Protected>
          }
        />
        <Route
          path="users"
          element={
            <Protected ownerOk roles={[ROLES.SUPERADMIN]}>
              <LoginsRedirect />
            </Protected>
          }
        />
        <Route
          path="team"
          element={
            <Protected module="team" roles={[ROLES.ADMIN]}>
              <TeamPage />
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
