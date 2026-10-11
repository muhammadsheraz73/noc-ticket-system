const HEX = /^#[0-9a-fA-F]{6}$/;

/** A few ready-made colours the owner can pick from; any colour also works. */
export const THEME_PRESETS = [
  { name: 'Orange', color: '#e35a00' },
  { name: 'Blue', color: '#1d4ed8' },
  { name: 'Green', color: '#15803d' },
  { name: 'Teal', color: '#0f766e' },
  { name: 'Purple', color: '#6d28d9' },
  { name: 'Red', color: '#b91c1c' },
  { name: 'Pink', color: '#be185d' },
  { name: 'Slate', color: '#334155' },
];

function parse(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return `#${rgb
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Blend `hex` toward `target` (an [r,g,b]) by `amount` 0–1. */
function mix(hex, target, amount) {
  const rgb = parse(hex);
  return toHex(rgb.map((v, i) => v + (target[i] - v) * amount));
}

const THEME_VARS = [
  '--brand', '--brand-dark', '--brand-light', '--brand-accent', '--sidebar-from', '--sidebar-to',
];

/** Paint the whole app in a client's colour; an empty/invalid colour restores the default. */
export function applyTheme(hex) {
  const root = document.documentElement;

  if (!HEX.test(hex || '')) {
    THEME_VARS.forEach((name) => root.style.removeProperty(name));
    return;
  }

  root.style.setProperty('--brand', hex);
  root.style.setProperty('--brand-accent', hex);
  root.style.setProperty('--brand-dark', mix(hex, [0, 0, 0], 0.25));
  root.style.setProperty('--brand-light', mix(hex, [255, 255, 255], 0.9));
  root.style.setProperty('--sidebar-from', mix(hex, [0, 0, 0], 0.72));
  root.style.setProperty('--sidebar-to', mix(hex, [0, 0, 0], 0.88));
}
