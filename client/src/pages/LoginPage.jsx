import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { errorMessage, signOutReason } from '../api/client.js';
import { Alert, Field, TextInput } from '../components/ui.jsx';

/** Three linked nodes: the product mark. */
function BrandIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="32" cy="12" r="7" />
      <circle cx="12" cy="50" r="7" />
      <circle cx="52" cy="50" r="7" />
      <path d="M32 19v10M32 29H12v14M32 29h20v14" />
    </svg>
  );
}

const FEATURES = ['Billing', 'Ticketing', 'Inventory', 'Invoicing'];

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Read once: why the last session ended (idle timeout or an expired token). */
  const [notice] = useState(() => {
    const reason = signOutReason.take();
    if (reason?.startsWith('idle')) {
      const minutes = Number(reason.split(':')[1]) || 5;
      return `You were signed out after ${minutes} minute${minutes === 1 ? '' : 's'} of inactivity. Please sign in again.`;
    }
    if (reason === 'expired') return 'Your session has expired. Please sign in again.';
    return '';
  });

  const signIn = async (nextIdentifier, nextPassword) => {
    setError('');
    setBusy(true);
    try {
      const user = await login(nextIdentifier, nextPassword);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Sign in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-hero">
        <span className="login-hero__grid" aria-hidden="true" />
        <span className="login-hero__orb login-hero__orb--1" aria-hidden="true" />
        <span className="login-hero__orb login-hero__orb--2" aria-hidden="true" />
        <span className="login-hero__orb login-hero__orb--3" aria-hidden="true" />
        <BrandIcon className="login-hero__icon" />
        <h1 className="login-hero__name">ISP MATRIX</h1>
        <p className="login-hero__tagline">ISP Billing &amp; Network Operations</p>
        <ul className="login-hero__features">
          {FEATURES.map((feature, index) => <li key={feature} style={{ '--i': index }}>{feature}</li>)}
        </ul>
        <div className="login-hero__footer">
          © {new Date().getFullYear()} ISP MATRIX. All rights reserved.
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <div className="login-card__mobile-brand">
            <BrandIcon />
            ISP MATRIX
          </div>

          <div className="login-card__intro">
            <h2 className="login-card__heading">Welcome back</h2>
            <p className="small muted">Sign in to your account to continue.</p>
          </div>

        {notice && !error ? <Alert tone="info">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="login-card__form">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            signIn(identifier, password);
          }}
        >
          <Field
            label="Username or email"
            required
            htmlFor="identifier"
            hint="Use the username your administrator gave you."
          >
            <TextInput
              id="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="username"
            />
          </Field>

          <Field label="Password" required htmlFor="password">
            <TextInput
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <button className="btn btn--block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

          <p className="login-card__footer small muted">
            Having trouble signing in? Contact your administrator.
          </p>
        </div>
        </div>
      </main>
    </div>
  );
}
