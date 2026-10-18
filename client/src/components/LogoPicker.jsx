import { useRef, useState } from 'react';

const MAX_W = 640;
const MAX_H = 320;
const MAX_CHARS = 680_000; // the server accepts ~500 KB of image

/**
 * Pick a logo image and hand back a PNG/JPEG data URL, scaled down in the
 * browser first so it stays small enough to store and print crisply.
 */
export default function LogoPicker({ value, onChange, error }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const pick = async (file) => {
    if (!file) return;
    setProblem('');
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(file.type)) {
      setProblem('Choose a PNG, JPG, WEBP or SVG image.');
      return;
    }
    setBusy(true);
    try {
      onChange(await shrink(file));
    } catch {
      setProblem('That image could not be read. Try another file.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="logo-picker">
      <div className={`logo-picker__box${value ? ' has-logo' : ''}`}>
        {value ? <img src={value} alt="Company logo" /> : <span className="muted small">No logo</span>}
      </div>
      <div className="logo-picker__side">
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <span className="spinner spinner--dark" /> : '⭱'} {value ? 'Change logo' : 'Upload logo'}
          </button>
          {value ? (
            <button type="button" className="btn btn--ghost btn--sm text-danger" onClick={() => onChange('')} disabled={busy}>
              Remove
            </button>
          ) : null}
        </div>
        <div className="small muted">PNG with a transparent background looks best. It is resized automatically.</div>
        {problem || error ? <div className="field__error">{problem || error}</div> : null}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Fit within MAX_W×MAX_H; keep transparency as PNG, fall back to JPEG if still too big. */
async function shrink(file) {
  const img = await loadImage(await readAsDataUrl(file));
  const scale = Math.min(1, MAX_W / (img.naturalWidth || MAX_W), MAX_H / (img.naturalHeight || MAX_H));
  const w = Math.max(1, Math.round((img.naturalWidth || MAX_W) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || MAX_H) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  let url = canvas.toDataURL('image/png');
  if (url.length > MAX_CHARS) {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    url = canvas.toDataURL('image/jpeg', 0.88);
  }
  if (url.length > MAX_CHARS) throw new Error('too large');
  return url;
}
