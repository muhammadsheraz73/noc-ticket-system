import { Alert, Modal } from './ui.jsx';

/** One-time hand-off sheet: the password exists nowhere else once this closes. */
export function CredentialsModal({ credentials, onClose, onCopied }) {
  if (!credentials) return null;

  const sheet = [
    'NOC Manager — sign in',
    `URL      : ${window.location.origin}`,
    `Username : ${credentials.username}`,
    `Email    : ${credentials.email}`,
    `Password : ${credentials.password}`,
  ].join('\n');

  return (
    <Modal
      open
      title={credentials.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--secondary" onClick={() => copyText(sheet, onCopied)}>
            📋 Copy credentials
          </button>
          <button className="btn" onClick={onClose}>Done</button>
        </>
      }
    >
      <Alert tone="warn" title="Shown only once">
        {`The server stores a hash, not the password. Copy it now and give it to ${credentials.name} — reopening this page cannot show it again.`}
      </Alert>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, userSelect: 'all' }}>{sheet}</pre>
    </Modal>
  );
}

async function copyText(text, onCopied) {
  try {
    await navigator.clipboard.writeText(text);
    onCopied?.(true);
  } catch {
    // The Clipboard API needs a secure context; fall back to a temporary textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    onCopied?.(ok);
  }
}

/** "Usman Tariq" → "usman.tariq", matching the server's username rules. */
export function suggestUsername(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^[.]+|[.]+$/g, '')
    .slice(0, 32);
}

// Look-alike characters (0/O, 1/l/I) are left out — these get read off a screen
// and typed by hand, often over the phone.
const PASSWORD_CLASSES = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%&*?',
];

/** Random password holding at least one character from every class. */
export function generatePassword(length = 14) {
  const all = PASSWORD_CLASSES.join('');
  const picks = [
    ...PASSWORD_CLASSES.map(pickChar),
    ...Array.from({ length: length - PASSWORD_CLASSES.length }, () => pickChar(all)),
  ];

  // Shuffle, otherwise the guaranteed characters always sit in class order.
  for (let i = picks.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.join('');
}

function pickChar(chars) {
  return chars[randomInt(chars.length)];
}

function randomInt(max) {
  const buffer = new Uint32Array(1);
  window.crypto.getRandomValues(buffer);
  return buffer[0] % max;
}
