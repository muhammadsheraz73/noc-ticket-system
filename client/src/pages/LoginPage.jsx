import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { errorMessage, signOutReason } from '../api/client.js';
import '../styles/lamp-login.css';

/** Only the username is remembered; the session token itself stays per-tab. */
const REMEMBER_KEY = 'noc.rememberedUser';
/** How far (in lamp units) the string must be pulled before it clicks. */
const PULL_TRIGGER = 34;
const PULL_MAX = 80;
/** Where the string hangs from, in the lamp's viewBox. */
const STRING_X = 190;
const STRING_TOP = 141;
const STRING_LENGTH = 92;

const remembered = {
  get() { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } },
  set(value) { try { localStorage.setItem(REMEMBER_KEY, value); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ } },
};

/* ------------------------------------------------------------------ icons */
const Icon = {
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
};

/* ------------------------------------------------------------------- lamp */
/**
 * The desk lamp. The pull cord is draggable: tug it down past PULL_TRIGGER and
 * let go to toggle the light; a plain click or Enter/Space does a full tug.
 */
function Lamp({ on, onToggle }) {
  const svgRef = useRef(null);
  const drag = useRef(null);
  const anim = useRef(0);
  const [pull, setPull] = useState(0);
  const [tug, setTug] = useState(0);

  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  /** Spring the cord back to rest with a little bounce. */
  const release = (from, fire) => {
    if (fire) {
      onToggle();
      setTug((n) => n + 1);
    }
    cancelAnimationFrame(anim.current);
    let pos = from;
    let vel = 0;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      vel += (-260 * pos - 11 * vel) * dt;
      pos += vel * dt;
      if (Math.abs(pos) < 0.2 && Math.abs(vel) < 2) {
        setPull(0);
        return;
      }
      setPull(pos);
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  /** Click / keyboard: pull down smoothly, then let go. */
  const autoPull = () => {
    cancelAnimationFrame(anim.current);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 170);
      const pos = PULL_TRIGGER + 18;
      setPull(pos * (1 - (1 - t) ** 3));
      if (t < 1) anim.current = requestAnimationFrame(step);
      else release(pos, true);
    };
    anim.current = requestAnimationFrame(step);
  };

  const unitsPerPixel = () => {
    const box = svgRef.current?.getBoundingClientRect();
    return box?.height ? 420 / box.height : 1;
  };

  const onPointerDown = (event) => {
    event.preventDefault();
    cancelAnimationFrame(anim.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, scale: unitsPerPixel(), moved: false, pull: 0 };
  };

  const onPointerMove = (event) => {
    if (!drag.current) return;
    const dy = (event.clientY - drag.current.y) * drag.current.scale;
    if (Math.abs(dy) > 3) drag.current.moved = true;
    // Rubber-band past the trigger point so it feels like a real cord.
    const next = dy <= 0 ? 0 : dy < PULL_TRIGGER ? dy : PULL_TRIGGER + (dy - PULL_TRIGGER) * 0.45;
    drag.current.pull = Math.min(PULL_MAX, next);
    setPull(drag.current.pull);
  };

  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (!state.moved) autoPull();
    else release(state.pull, state.pull >= PULL_TRIGGER);
  };

  const knobY = STRING_TOP + STRING_LENGTH + pull;

  return (
    <div className={`lamp${on ? ' is-on' : ''}${pull > 1 ? ' is-pulling' : ''}`}>
      <svg
        ref={svgRef}
        className="lamp__svg"
        viewBox="0 0 300 420"
        overflow="visible"
        aria-hidden="false"
        role="img"
        aria-label={on ? 'Desk lamp, switched on' : 'Desk lamp, switched off'}
      >
        <defs>
          <linearGradient id="lamp-beam" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor="#ffd27a" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#f6b24a" stopOpacity="0.2" />
            <stop offset="1" stopColor="#f6b24a" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="lamp-inner" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stopColor="#fff3cf" />
            <stop offset="0.45" stopColor="#ffc967" />
            <stop offset="1" stopColor="#d98a1f" />
          </radialGradient>
          <radialGradient id="lamp-bulb" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#fff0c2" />
            <stop offset="1" stopColor="#ffc761" />
          </radialGradient>
          <linearGradient id="lamp-shade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a3d43" />
            <stop offset="0.55" stopColor="#1d1f23" />
            <stop offset="1" stopColor="#111215" />
          </linearGradient>
          <linearGradient id="lamp-opening" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a3e45" />
            <stop offset="1" stopColor="#1c1e22" />
          </linearGradient>
          <linearGradient id="lamp-arm" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2b2e33" />
            <stop offset="0.5" stopColor="#3b3f46" />
            <stop offset="1" stopColor="#17191c" />
          </linearGradient>
          <linearGradient id="lamp-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd27d" />
            <stop offset="0.5" stopColor="#e7a93a" />
            <stop offset="1" stopColor="#b47714" />
          </linearGradient>
          <filter id="lamp-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="lamp-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* light beam, under everything */}
        <g className="lamp__beam">
          <path d="M126 146 L272 156 L640 640 L-10 640 Z" fill="url(#lamp-beam)" filter="url(#lamp-blur)" />
        </g>

        {/* floor shadow + base */}
        <ellipse cx="112" cy="398" rx="96" ry="14" fill="#000" opacity="0.55" filter="url(#lamp-glow)" />
        <ellipse cx="112" cy="388" rx="82" ry="15" fill="#15171a" />
        <ellipse cx="112" cy="384" rx="80" ry="13" fill="#24272c" />
        <ellipse cx="112" cy="382" rx="66" ry="8" fill="#2c3036" opacity="0.7" />

        {/* lower arm */}
        <line x1="124" y1="376" x2="94" y2="232" stroke="url(#lamp-arm)" strokeWidth="12" strokeLinecap="round" />
        <line x1="121" y1="372" x2="92" y2="236" stroke="#4a4f57" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        {/* upper arm */}
        <line x1="94" y1="232" x2="146" y2="118" stroke="url(#lamp-arm)" strokeWidth="6" strokeLinecap="round" />

        {/* base joint */}
        <circle cx="124" cy="376" r="15" fill="url(#lamp-gold)" />
        <circle cx="124" cy="376" r="6.5" fill="#1a1c20" />
        {/* elbow joint */}
        <circle cx="94" cy="232" r="13" fill="url(#lamp-gold)" />
        <circle cx="94" cy="232" r="5.5" fill="#1a1c20" />

        {/* shade (wobbles a little on every tug) */}
        <g transform="rotate(6 196 96)">
          <g className={`lamp__shade${tug ? ' is-tugged' : ''}`} key={tug}>
            <ellipse className="lamp__halo" cx="196" cy="100" rx="86" ry="70" fill="#ffb84a" filter="url(#lamp-blur)" />
            <path
              d="M128 140 C126 84 150 30 198 30 C242 31 266 80 264 140 Z"
              fill="url(#lamp-shade)"
              stroke="#0c0d0f"
              strokeWidth="1"
            />
            <path d="M150 64 C160 46 176 38 190 37" stroke="#5b6068" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.6" />
            {/* opening */}
            <ellipse cx="196" cy="140" rx="68" ry="14" fill="url(#lamp-opening)" />
            <ellipse className="lamp__inner" cx="196" cy="140" rx="68" ry="14" fill="url(#lamp-inner)" />
            <ellipse cx="196" cy="140" rx="68" ry="14" fill="none" stroke="url(#lamp-gold)" strokeWidth="3.2" />
            {/* bulb */}
            <circle className="lamp__bulb-glow" cx="196" cy="128" r="20" fill="#fff1c4" filter="url(#lamp-glow)" />
            <circle className="lamp__bulb" cx="196" cy="128" r="12" />
            <path d="M190 122 a7 7 0 0 1 7 -4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.8" />
          </g>
        </g>

        {/* pull cord */}
        <line
          className="lamp__cord"
          x1={STRING_X}
          y1={STRING_TOP}
          x2={STRING_X}
          y2={knobY}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <g
          className="lamp__knob"
          transform={`translate(${STRING_X} ${knobY}) scale(1.3)`}
          role="button"
          tabIndex={0}
          aria-pressed={on}
          aria-label={on ? 'Pull string to turn the lamp off' : 'Pull string to turn the lamp on'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              autoPull();
            }
          }}
        >
          <circle className="lamp__knob-glow" cx="0" cy="8" r="13" fill="#ffbe55" filter="url(#lamp-glow)" />
          <circle r="22" cy="6" fill="transparent" />
          <path d="M-2 0 h4 l4.5 13 a6.5 3.2 0 0 1 -13 0 Z" fill="url(#lamp-gold)" />
          <ellipse cx="0" cy="13.2" rx="6.5" ry="2.4" fill="#b47714" />
        </g>
      </svg>

      <div className="lamp__hint" aria-hidden="true">Pull string to turn on</div>
    </div>
  );
}

/** Dust specks floating in the light. Positions are fixed so they don't jump on re-render. */
function Dust() {
  const specks = useMemo(() => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    return Array.from({ length: 34 }, () => ({
      left: `${rand() * 100}%`,
      top: `${rand() * 100}%`,
      size: 1 + rand() * 2.6,
      delay: `${-rand() * 14}s`,
      duration: `${10 + rand() * 12}s`,
      drift: `${(rand() - 0.5) * 70}px`,
    }));
  }, []);

  return (
    <div className="lamp-login__dust" aria-hidden="true">
      {specks.map((s, i) => (
        <span
          key={i}
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            animationDelay: s.delay,
            animationDuration: s.duration,
            '--drift': s.drift,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- page */
export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [lightOn, setLightOn] = useState(false);
  const [tab, setTab] = useState('signin');
  const [identifier, setIdentifier] = useState(() => remembered.get());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => Boolean(remembered.get()));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const identifierRef = useRef(null);
  const passwordRef = useRef(null);
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

  // Once the light is on, put the cursor where the user needs to type.
  useEffect(() => {
    if (!lightOn || tab !== 'signin') return undefined;
    const timer = setTimeout(() => {
      (identifier ? passwordRef : identifierRef).current?.focus({ preventScroll: true });
    }, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightOn, tab]);

  const signIn = async () => {
    setError('');
    setBusy(true);
    try {
      const user = await login(identifier.trim(), password);
      if (remember) remembered.set(identifier.trim());
      else remembered.clear();
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      // Every sign-in lands on that panel's dashboard, wherever the user was before.
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Sign in failed'));
      setBusy(false);
    }
  };

  return (
    <div className={`lamp-login${lightOn ? ' is-on' : ''}`}>
      <div className="lamp-login__ambient" aria-hidden="true" />
      <Dust />

      <div className="lamp-login__stage">
        <div className="lamp-login__lamp">
          <Lamp on={lightOn} onToggle={() => setLightOn((v) => !v)} />
        </div>

        <main className="lamp-card" aria-hidden={!lightOn} inert={lightOn ? undefined : ''}>
          <h1 className="lamp-card__title">Welcome</h1>
          <p className="lamp-card__subtitle">Sign in to continue to your account</p>

          <div className="lamp-tabs" role="tablist">
            <span className={`lamp-tabs__pill${tab === 'signup' ? ' is-right' : ''}`} aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              className={tab === 'signin' ? 'is-active' : ''}
              onClick={() => setTab('signin')}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              className={tab === 'signup' ? 'is-active' : ''}
              onClick={() => setTab('signup')}
            >
              Sign Up
            </button>
          </div>

          {tab === 'signin' ? (
            <form
              className="lamp-form"
              key="signin"
              onSubmit={(event) => {
                event.preventDefault();
                signIn();
              }}
            >
              {notice && !error ? <div className="lamp-alert lamp-alert--info">{notice}</div> : null}
              {error ? <div className="lamp-alert lamp-alert--error" role="alert">{error}</div> : null}

              <label className="lamp-field">
                <span className="lamp-field__label">Username or Email</span>
                <span className="lamp-input">
                  <span className="lamp-input__icon">{Icon.user}</span>
                  <input
                    ref={identifierRef}
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Enter your username"
                  />
                </span>
              </label>

              <div className="lamp-field">
                <label className="lamp-field__label" htmlFor="lamp-password">Password</label>
                <span className="lamp-input">
                  <span className="lamp-input__icon">{Icon.lock}</span>
                  <input
                    ref={passwordRef}
                    id="lamp-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    className="lamp-input__toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? Icon.eyeOff : Icon.eye}
                  </button>
                </span>
              </div>

              <label className="lamp-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span className="lamp-check__box">{Icon.check}</span>
                Remember me
              </label>

              <button className="lamp-submit" type="submit" disabled={busy} aria-label={busy ? 'Signing in' : undefined}>
                {busy ? <span className="lamp-submit__spinner" /> : 'Sign In'}
              </button>
            </form>
          ) : (
            <div className="lamp-form lamp-signup" key="signup">
              <div className="lamp-signup__icon">{Icon.user}</div>
              <h2>Accounts are created by your admin</h2>
              <p>
                For security, new users can't sign themselves up. Ask your administrator for a
                username and password, then sign in.
              </p>
              <button type="button" className="lamp-submit" onClick={() => setTab('signin')}>
                Back to Sign In
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
