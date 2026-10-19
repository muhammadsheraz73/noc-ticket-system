/**
 * A typeset wordmark used in place of a logo on quotations and invoices:
 * a round badge with the company's initials, then the name in capitals with
 * the first word in the client's theme colour, underlined by a short accent.
 *
 *   (ZC)  ZEE CONNECT
 *         ‾‾‾‾
 */

const SPACING = 1.6;

function parts(name) {
  const words = String(name || '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 1)) || '?';
  return { first: words[0] || '', rest: words.slice(1).join(' '), initials };
}

function measureText(doc, { first, rest }, size) {
  doc.font('Helvetica-Bold').fontSize(size);
  return doc.widthOfString(rest ? `${first} ${rest}` : first, { characterSpacing: SPACING });
}

/**
 * How wide the wordmark will be, shrinking the type until it fits `maxWidth`.
 * @returns {{ width: number, size: number }}
 */
export function measureWordmark(doc, name, { height, maxWidth }) {
  const p = parts(name);
  const badge = height * 0.78;
  let size = Math.round(height * 0.42);
  while (size > 10 && badge + 10 + measureText(doc, p, size) > maxWidth) size -= 1;
  return { width: badge + 10 + measureText(doc, p, size), size };
}

/**
 * Draw the wordmark with its top-left at (x, y), vertically centred in `height`.
 * @param opts { height, maxWidth, brand, ink }
 */
export function drawWordmark(doc, name, { x, y, height, maxWidth = 400, brand, ink = '#0f172a' }) {
  const p = parts(name);
  const { size } = measureWordmark(doc, name, { height, maxWidth });
  const badge = height * 0.78;
  const r = badge / 2;
  const cy = y + height / 2;

  // Initials badge
  doc.circle(x + r, cy, r).fill(brand);
  doc.circle(x + r, cy, r - 2.2).lineWidth(0.8).stroke('#ffffff');
  const initialsSize = p.initials.length > 1 ? r * 0.82 : r * 1.0;
  doc.font('Helvetica-Bold').fontSize(initialsSize).fillColor('#ffffff');
  const iw = doc.widthOfString(p.initials, { characterSpacing: 0.5 });
  doc.text(p.initials, x + r - iw / 2, cy - initialsSize * 0.36, { lineBreak: false, characterSpacing: 0.5 });

  // Name: first word in the theme colour, the rest in ink
  const tx = x + badge + 10;
  const ty = cy - size * 0.62;
  doc.font('Helvetica-Bold').fontSize(size).fillColor(brand)
    .text(p.rest ? `${p.first} ` : p.first, tx, ty, { lineBreak: false, continued: Boolean(p.rest), characterSpacing: SPACING });
  if (p.rest) doc.fillColor(ink).text(p.rest, { lineBreak: false, characterSpacing: SPACING });

  // Accent under the first word
  doc.font('Helvetica-Bold').fontSize(size);
  const firstW = doc.widthOfString(p.first, { characterSpacing: SPACING });
  doc.roundedRect(tx, ty + size * 1.02, Math.max(18, firstW * 0.55), 2.6, 1.3).fill(brand);

  return badge + 10 + measureText(doc, p, size);
}
