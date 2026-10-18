/**
 * "Bank details" block shared by the quotation and invoice PDFs: one card per
 * account, two cards to a row.
 */

const LINE_H = 13;
const ROW_GAP = 8;
const COL_GAP = 12;
const LABEL_H = 16;

/** Bank, Account No. and IBAN always; Branch only when some account has one. */
const linesFor = (accounts) => (accounts.some((a) => a.branch) ? 4 : 3);
const cardHeight = (accounts) => 32 + linesFor(accounts) * LINE_H;

export function bankBlockHeight(accounts = []) {
  if (!accounts.length) return 0;
  const rows = Math.ceil(accounts.length / 2);
  return LABEL_H + rows * cardHeight(accounts) + (rows - 1) * ROW_GAP;
}

/**
 * @param doc       PDFKit document
 * @param accounts  [{ title, bank, branch, accountNumber, iban }]
 * @param opts      { x, y, width, accent, tintColor, ink, muted }
 * @returns the y just below the block
 */
export function drawBankBlock(doc, accounts = [], { x, y, width, accent, tintColor, ink = '#0f172a', muted = '#64748b' }) {
  if (!accounts.length) return y;

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(accent).text('BANK DETAILS', x, y, { characterSpacing: 0.8 });
  let top = y + LABEL_H;
  const CARD_H = cardHeight(accounts);
  const withBranch = linesFor(accounts) === 4;
  const perRow = Math.min(2, accounts.length);
  const cardW = (width - COL_GAP * (perRow - 1)) / perRow;

  accounts.forEach((account, i) => {
    const col = i % 2;
    if (i > 0 && col === 0) top += CARD_H + ROW_GAP;
    const cx = x + col * (cardW + COL_GAP);

    doc.roundedRect(cx, top, cardW, CARD_H, 4).fill(tintColor);
    doc.rect(cx, top, 3, CARD_H).fill(accent);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink)
      .text(account.title, cx + 12, top + 9, { width: cardW - 24, lineBreak: false, ellipsis: true });

    const rows = [
      ['Bank', account.bank || '—'],
      ...(withBranch ? [['Branch', account.branch || '—']] : []),
      ['Account No.', account.accountNumber || '—'],
      ['IBAN', account.iban || '—'],
    ];
    let ry = top + 26;
    for (const [label, value] of rows) {
      doc.font('Helvetica').fontSize(7.8).fillColor(muted).text(label, cx + 12, ry, { width: 62 });
      doc.font('Helvetica-Bold').fontSize(8.6).fillColor(ink)
        .text(value, cx + 76, ry - 0.5, { width: cardW - 88, lineBreak: false, ellipsis: true });
      ry += LINE_H;
    }
  });

  return top + CARD_H;
}
