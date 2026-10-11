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

/**
 * Crop transparent or white margins so a logo fills its frame instead of
 * floating small inside empty padding. Falls back to the original if the
 * image is blank or the pixels cannot be read.
 */
function trimMargins(canvas) {
  try {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    const isBackground = (i) => data[i + 3] < 12 || (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245);

    let top = height;
    let left = width;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isBackground((y * width + x) * 4)) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < left || bottom < top) return canvas;

    const pad = 2;
    left = Math.max(0, left - pad);
    top = Math.max(0, top - pad);
    right = Math.min(width - 1, right + pad);
    bottom = Math.min(height - 1, bottom + pad);

    const out = document.createElement('canvas');
    out.width = right - left + 1;
    out.height = bottom - top + 1;
    out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  } catch {
    return canvas;
  }
}

/**
 * Read an image file and shrink it to a small PNG data URL, so a logo stays a
 * few KB no matter how large the original was.
 */
export function fileToLogoDataUrl(file, maxSize = 320) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      reject(new Error('Please choose a PNG, JPEG or WebP image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(trimMargins(canvas).toDataURL('image/png'));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    image.src = url;
  });
}
