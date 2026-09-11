import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { TOKEN_KEY, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export const ROLES = {
  ADMIN: 'admin',
  NOC_OPERATOR: 'noc_operator',
  FIELD_ENGINEER: 'field_engineer',
  ACCOUNTS: 'accounts',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  /**
   * Difference between the server clock and this browser's clock.
   * Every countdown is rendered against server time, so a wrong local clock
   * can never make a ticket look on-time when the server says it is overdue.
   */
  const clockOffset = useRef(0);

  const applySession = useCallback((nextUser, serverTime) => {
    setUser(nextUser);
    if (serverTime) clockOffset.current = new Date(serverTime).getTime() - Date.now();
  }, []);

  const logout = useCallback(async () => {
    try {
      if (localStorage.getItem(TOKEN_KEY)) await api.post('/auth/logout');
    } catch {
      // A failed logout call must never trap the user in the app.
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!localStorage.getItem(TOKEN_KEY)) {
        setReady(true);
        return;
      }
      try {
        const { data } = await api.get('/auth/me');
        if (!cancelled) applySession(data.user, data.serverTime);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const login = useCallback(
    /** @param identifier the account's username or email */
    async (identifier, password) => {
      const { data } = await api.post('/auth/login', { identifier, password });
      localStorage.setItem(TOKEN_KEY, data.token);
      applySession(data.user, new Date().toISOString());
      return data.user;
    },
    [applySession],
  );

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      setUser,
      /** Current time as the *server* sees it. */
      serverNow: () => new Date(Date.now() + clockOffset.current),
      syncClock: (serverTime) => {
        if (serverTime) clockOffset.current = new Date(serverTime).getTime() - Date.now();
      },
      hasRole: (...roles) => Boolean(user) && roles.flat().includes(user.role),
      isAdmin: user?.role === ROLES.ADMIN,
      canManageTickets: [ROLES.ADMIN, ROLES.NOC_OPERATOR].includes(user?.role),
      canManageInvoices: [ROLES.ADMIN, ROLES.ACCOUNTS].includes(user?.role),
      canViewInvoices: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR].includes(user?.role),
      canViewNetwork: [ROLES.ADMIN, ROLES.NOC_OPERATOR].includes(user?.role),
    }),
    [user, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
