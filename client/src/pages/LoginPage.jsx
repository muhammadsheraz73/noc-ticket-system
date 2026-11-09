import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { errorMessage, signOutReason } from '../api/client.js';
import '../styles/login.css';

/** Three linked nodes: the product mark. */
function BrandMark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="32" cy="12" r="7" />
      <circle cx="12" cy="50" r="7" />
      <circle cx="52" cy="50" r="7" />
      <path d="M32 19v10M32 29H12v14M32 29h20v14" />
    </svg>
  );
}

const Icon = {
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20" />
    </svg>
  ),
};

/**
 * Sign in: one centred column on every screen — the logo, then the form.
 * Labels sit above the fields; the password can be shown or hidden.
 */
export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Why the last session ended is not shown here — just clear it so it never lingers.
  useState(() => signOutReason.take());

  const signIn = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(identifier, password);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      // Every sign-in lands on that panel's dashboard, wherever the user was before.
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Sign in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <main className="auth__main">
        <div className="auth__form-wrap">
          <header className="auth__brand">
            <span className="auth__logo"><BrandMark /></span>
            <span className="auth__brand-name">ISP <b>MATRIX</b></span>
          </header>

          <h1 className="auth__title">Welcome back</h1>
          <p className="auth__subtitle">Sign in to manage your tickets, customers and billing.</p>

          {error ? <div className="auth__error" role="alert">{error}</div> : null}

          <form className="auth__form" onSubmit={signIn}>
            <div className="auth__field">
              <label htmlFor="identifier">Username or email</label>
              <input
                id="identifier"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="e.g. ali.raza"
              />
            </div>

            <div className="auth__field">
              <label htmlFor="password">Password</label>
              <div className="auth__password">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="auth__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? Icon.eyeOff : Icon.eye}
                </button>
              </div>
            </div>

            <button className="auth__submit" type="submit" disabled={busy}>
              {busy ? <span className="auth__spinner" aria-hidden="true" /> : null}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="auth__help">Trouble signing in? Contact your administrator.</p>
        </div>

        <footer className="auth__footer">© {new Date().getFullYear()} ISP MATRIX</footer>
      </main>
    </div>
  );
}
