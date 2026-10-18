import { useEffect, useRef, useState } from 'react';
import { Alert, Loading } from './ui.jsx';

/** pdf.js is ~1MB — loaded on demand rather than bundled into the main chunk. */
let pdfjsReady;
function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjsLib, worker]) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjsLib;
      },
    );
  }
  return pdfjsReady;
}

/**
 * Draws PDF bytes page by page onto <canvas>. Used instead of an <iframe>
 * because some hosts (e.g. a VS Code webview) have no built-in PDF viewer.
 */
export default function PdfPreview({ bytes, loading = false }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (!bytes) return undefined;
    let cancelled = false;
    setError('');
    setRendering(true);
    const container = ref.current;
    if (container) container.innerHTML = '';

    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        for (let n = 1; n <= pdf.numPages; n += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'pdf-preview__page';
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (!cancelled && container) container.appendChild(canvas);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not render the PDF preview');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => { cancelled = true; };
  }, [bytes]);

  return (
    <div className="pdf-preview">
      {error ? <Alert tone="error" title="Preview unavailable">{error} — use Download PDF instead.</Alert> : null}
      {loading || (rendering && !ref.current?.childElementCount) ? <Loading label="Preparing the PDF…" /> : null}
      <div ref={ref} />
    </div>
  );
}
