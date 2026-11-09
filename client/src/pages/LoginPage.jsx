import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { errorMessage, signOutReason } from '../api/client.js';
import '../styles/login.css';

const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="7.5" r="4.5" />
    <path d="M3.5 21a8.5 8.5 0 0 1 17 0Z" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 10V7.5a5 5 0 0 1 10 0V10h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm2.2 0h5.6V7.5a2.8 2.8 0 0 0-5.6 0Z" />
  </svg>
);

/**
 * Sign-in: a white card with an orange welcome panel whose edge curves into the
 * form, and soft orange circles around it. One username-or-email field, the
 * password (with Show/Hide) and the Sign in button.
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
    <div className="signin">
      <div className="signin__card">
        <span className="signin__shape" aria-hidden="true" />
        <span className="signin__ball signin__ball--big" aria-hidden="true" />
        <span className="signin__ball signin__ball--mid" aria-hidden="true" />
        <span className="signin__ball signin__ball--corner" aria-hidden="true" />

        <section className="signin__welcome">
          <h1 className="signin__welcome-title">ISP MATRIX</h1>
          <p className="signin__welcome-name">ISP Billing &amp; Network Operations</p>
          <p className="signin__welcome-text">
            Billing, ticketing, inventory and invoicing for your ISP — all in one panel.
            Sign in with the username your administrator gave you.
          </p>
        </section>

        <main className="signin__form-side">
          <h2 className="signin__title">Welcome</h2>
          <p className="signin__subtitle">Sign in to your account to continue.</p>

          {error ? <div className="signin__error" role="alert">{error}</div> : null}

          <form className="signin__form" onSubmit={signIn}>
            <label className="signin__sr" htmlFor="identifier">Username or email</label>
            <div className="signin__input">
              <span className="signin__icon"><UserIcon /></span>
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
                placeholder="Username or email"
              />
            </div>

            <label className="signin__sr" htmlFor="password">Password</label>
            <div className="signin__input">
              <span className="signin__icon"><LockIcon /></span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
              <button
                type="button"
                className="signin__show"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'HIDE' : 'SHOW'}
              </button>
            </div>

            <button className="signin__submit" type="submit" disabled={busy}>
              {busy ? <span className="signin__spinner" aria-hidden="true" /> : null}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="signin__help">
            Having trouble signing in? <span>Contact your administrator</span>
          </p>
        </main>
      </div>
    </div>
  );
}
