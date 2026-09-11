import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { errorMessage } from '../api/client.js';
import { Alert, Field, TextInput } from '../components/ui.jsx';

const DEMO_ACCOUNTS = [
  { role: 'Admin', username: 'admin', password: 'Admin@123', icon: '🛡' },
  { role: 'NOC Operator', username: 'noc', password: 'Noc@12345', icon: '🎧' },
  { role: 'Field Engineer', username: 'field', password: 'Field@12345', icon: '🔧' },
  { role: 'Accounts', username: 'accounts', password: 'Accounts@123', icon: '🧾' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      <div className="login-card">
        <div className="login-card__brand">
          <div className="login-card__logo">NOC</div>
          <div>
            <h1 style={{ fontSize: 18 }}>NOC Manager</h1>
            <div className="small muted">Ticket &amp; Customer Network System</div>
          </div>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}

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

        <div className="login-demo">
          <div className="login-demo__title">Demo accounts — click to sign in</div>
          <div className="login-demo__grid">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.username}
                type="button"
                className="login-demo__btn"
                disabled={busy}
                onClick={() => {
                  setIdentifier(account.username);
                  setPassword(account.password);
                  signIn(account.username, account.password);
                }}
              >
                <span>{account.icon}</span>
                <span>
                  <strong>{account.role}</strong>
                  <span className="muted"> · {account.username}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
