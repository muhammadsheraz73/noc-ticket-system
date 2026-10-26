import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { setUnauthorizedHandler, signOutReason, tokenStore } from '../api/client.js';

const AuthContext = createContext(null);

/** Activity that counts as "still using the panel". */
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'scroll', 'touchstart'];
const DEFAULT_IDLE_MINUTES = 5;
/** While active, renew the server-side session at most this often (even with no saves). */
const PING_EVERY_MS = 60 * 1000;

export const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  NOC_OPERATOR: 'noc_operator',
  FIELD_ENGINEER: 'field_engineer',
  ACCOUNTS: 'accounts',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(DEFAULT_IDLE_MINUTES);

  /**
   * Difference between the server clock and this browser's clock.
   * Every countdown is rendered against server time, so a wrong local clock
   * can never make a ticket look on-time when the server says it is overdue.
   */
  const clockOffset = useRef(0);

  const applySession = useCallback((nextUser, serverTime, session) => {
    setUser(nextUser);
    if (serverTime) clockOffset.current = new Date(serverTime).getTime() - Date.now();
    if (session?.idleMinutes) setIdleMinutes(session.idleMinutes);
  }, []);

  const logout = useCallback(async (reason) => {
    try {
      if (tokenStore.get()) await api.post('/auth/logout');
    } catch {
      // A failed logout call must never trap the user in the app.
    }
    tokenStore.clear();
    if (reason) signOutReason.set(reason);
    setUser(null);
  }, []);

  /**
   * Sign out after `idleMinutes` without any mouse, keyboard, scroll or touch
   * activity. Checked on a timer and whenever the tab becomes visible again,
   * so a sleeping laptop or a background tab is caught as soon as it returns.
   */
  useEffect(() => {
    if (!user) return undefined;
    const limit = idleMinutes * 60 * 1000;
    let lastActivity = Date.now();
    let lastPing = Date.now();

    const markActive = () => { lastActivity = Date.now(); };
    const check = () => {
      const now = Date.now();
      if (now - lastActivity >= limit) {
        logout(`idle:${idleMinutes}`);
        return;
      }
      // Busy but not saving anything (typing a long form): keep the server session alive.
      if (lastActivity > lastPing && now - lastPing >= PING_EVERY_MS) {
        lastPing = now;
        api.post('/auth/ping').catch(() => {});
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 5000);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive));
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [user, idleMinutes, logout]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!tokenStore.get()) {
        setReady(true);
        return;
      }
      try {
        const { data } = await api.get('/auth/me');
        if (!cancelled) applySession(data.user, data.serverTime, data.session);
      } catch {
        tokenStore.clear();
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
      tokenStore.set(data.token);
      signOutReason.take();
      applySession(data.user, new Date().toISOString(), data.session);
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
      isOwner: user?.role === ROLES.SUPERADMIN,
      canManageTickets: [ROLES.ADMIN, ROLES.NOC_OPERATOR].includes(user?.role),
      canManageInvoices: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR].includes(user?.role),
      canViewInvoices: [ROLES.ADMIN, ROLES.ACCOUNTS, ROLES.NOC_OPERATOR, ROLES.FIELD_ENGINEER].includes(user?.role),
      canViewNetwork: [ROLES.ADMIN, ROLES.NOC_OPERATOR].includes(user?.role),
      /** True when the panel owner has locked this feature for this login (or its whole client). */
      isLocked: (module) => Boolean(module && user?.lockedModules?.includes(module)),
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
