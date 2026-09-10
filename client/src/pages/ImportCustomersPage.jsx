import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Alert, Badge, Field, Select, Stat } from '../components/ui.jsx';

/**
 * Excel import: upload ➜ map columns ➜ validate ➜ import ➜ result report.
 * Existing customers are never overwritten unless the operator opts in.
 */
export default function ImportCustomersPage() {
  const toast = useToast();
  const fileRef = useRef(null);

  const [step, setStep] = useState(1);
  const [upload, setUpload] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState([]);
  const [summary, setSummary] = useState(null);
  const [strategy, setStrategy] = useState('skip');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post('/customers/import/upload', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUpload(data);
      setMapping(data.mapping);
      setPreview(data.preview);
      setSummary(data.summary);
      setStep(2);
      toast.success('File parsed', `${data.totalRows} row(s) found in “${data.sheetName}”`);
    } catch (err) {
      setError(errorMessage(err));
      toast.error('Could not read the file', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revalidate = async (nextMapping) => {
    setBusy(true);
    try {
      const { data } = await api.post('/customers/import/preview', {
        rows: upload.rows,
        mapping: nextMapping,
      });
      setPreview(data.preview);
      setSummary(data.summary);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setColumn = (field, column) => {
    const next = { ...mapping };
    if (column) next[field] = column;
    else delete next[field];
    setMapping(next);
    revalidate(next);
  };

  const runImport = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/customers/import', {
        rows: upload.rows,
        mapping,
        duplicateStrategy: strategy,
      });
      setResult(data.report);
      setStep(3);
      toast.success(
        'Import finished',
        `${data.report.imported} imported · ${data.report.updated} updated · ${data.report.skipped} skipped · ${data.report.failed} failed`,
      );
    } catch (err) {
      setError(errorMessage(err));
      toast.error('Import failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const response = await api.get('/customers/import/template', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'customer-import-template.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Could not download the template', errorMessage(err));
    }
  };

  const restart = () => {
    setStep(1); setUpload(null); setMapping({}); setPreview([]);
    setSummary(null); setResult(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const requiredMissing = (upload?.importableFields ?? [])
    .filter((f) => f.required && !mapping[f.field])
    .map((f) => f.label);

  return (
    <>
      <PageHead
        back="/customers"
        title="Import customers from Excel"
        subtitle="Upload .xlsx / .xls / .csv, map the columns, review, then import."
        actions={<button className="btn btn--secondary" onClick={downloadTemplate}>⭳ Download template</button>}
      />

      <div className="steps">
        <div className={`step ${step === 1 ? 'is-active' : step > 1 ? 'is-done' : ''}`}><span className="step__num">1</span> Upload file</div>
        <div className={`step ${step === 2 ? 'is-active' : step > 2 ? 'is-done' : ''}`}><span className="step__num">2</span> Map &amp; review</div>
        <div className={`step ${step === 3 ? 'is-active' : ''}`}><span className="step__num">3</span> Result report</div>
      </div>

      {error ? <Alert tone="error" title="Import problem">{error}</Alert> : null}

      {step === 1 ? (
        <div className="card">
          <div className="card__body">
            <div
              className={`dropzone${dragOver ? ' is-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
            >
              <div className="dropzone__icon">{busy ? '⏳' : '📄'}</div>
              <div className="strong">{busy ? 'Reading the file…' : 'Click to choose a spreadsheet, or drop it here'}</div>
              <div className="small muted">.xlsx, .xls or .csv — up to 10 MB. The first sheet is used.</div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
            </div>

            <Alert tone="info" title="Safe by default">
              Existing customers are never overwritten silently. Rows matching a customer already in the system are
              skipped unless you explicitly choose to update them.
            </Alert>
          </div>
        </div>
      ) : null}

      {step === 2 && upload ? (
        <div className="stack">
          <div className="grid grid--stats">
            <Stat label="Rows in file" value={upload.totalRows} />
            <Stat label="New customers" value={summary?.new ?? 0} tone="ok" />
            <Stat label="Already exist" value={summary?.existing ?? 0} tone="warn" />
            <Stat label="Duplicates in file" value={summary?.duplicateInFile ?? 0} tone="warn" />
            <Stat label="Invalid rows" value={summary?.invalid ?? 0} tone="danger" />
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Map columns</h2>
              <div className="card__head-actions">
                <span className="small muted">File: {upload.fileName} · sheet “{upload.sheetName}”</span>
              </div>
            </div>
            <div className="card__body">
              {requiredMissing.length ? (
                <Alert tone="error" title="Required fields not mapped">{requiredMissing.join(', ')}</Alert>
              ) : (
                <Alert tone="ok" title="All required fields are mapped">You can proceed with the import.</Alert>
              )}

              <div className="form-grid">
                {upload.importableFields.map((field) => (
                  <Field key={field.field} label={field.label} required={field.required}>
                    <Select value={mapping[field.field] || ''} onChange={(event) => setColumn(field.field, event.target.value)}>
                      <option value="">— not mapped —</option>
                      {upload.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Preview &amp; validation</h2>
              <div className="card__head-actions">
                <span className="small muted">First {preview.length} row(s)</span>
              </div>
            </div>
            <div className="card__body card__body--flush">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Row</th><th>Status</th><th>Customer ID</th><th>Name</th><th>Type</th><th>Connected From</th><th>Contact</th><th>Issues</th></tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="num muted">{row.rowNumber}</td>
                        <td><Badge tone={rowTone(row.status)}>{rowLabel(row.status)}</Badge></td>
                        <td className="mono">{row.data.customerReferenceNumber || '—'}</td>
                        <td>{row.data.name || '—'}</td>
                        <td>{row.data.type || '—'}</td>
                        <td>{row.data.connectedFrom || '—'}</td>
                        <td className="mono small">{row.data.contactNumber || '—'}</td>
                        <td className="small text-danger">{row.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card__foot">
              <div className="row">
                <div style={{ flex: '0 1 280px' }}>
                  <Field label="If a customer already exists">
                    <Select value={strategy} onChange={(event) => setStrategy(event.target.value)}>
                      <option value="skip">Skip it — keep the existing record (recommended)</option>
                      <option value="update">Update it with the values from the file</option>
                    </Select>
                  </Field>
                </div>
                <span className="spacer" />
                <button className="btn btn--secondary" onClick={restart} disabled={busy}>Start over</button>
                <button className="btn" onClick={runImport} disabled={busy || requiredMissing.length > 0}>
                  {busy ? <span className="spinner" /> : null}
                  Import {upload.totalRows} row(s)
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === 3 && result ? (
        <div className="stack">
          <div className="grid grid--stats">
            <Stat label="Imported" value={result.imported} tone="ok" />
            <Stat label="Updated" value={result.updated} tone="ok" />
            <Stat label="Skipped" value={result.skipped} tone="warn" />
            <Stat label="Failed" value={result.failed} tone="danger" />
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Import result report</h2>
              <div className="card__head-actions">
                <button className="btn btn--secondary btn--sm" onClick={restart}>Import another file</button>
                <Link className="btn btn--sm" to="/customers">View customers</Link>
              </div>
            </div>
            <div className="card__body card__body--flush">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Row</th><th>Reference</th><th>Outcome</th><th>Message</th></tr></thead>
                  <tbody>
                    {result.details.map((detail, index) => (
                      <tr key={index}>
                        <td className="num muted">{detail.rowNumber}</td>
                        <td className="mono">{detail.reference}</td>
                        <td><Badge tone={outcomeTone(detail.outcome)}>{detail.outcome}</Badge></td>
                        <td className="small">{detail.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function rowTone(status) {
  return { new: 'ok', existing: 'warn', duplicate_in_file: 'warn', invalid: 'danger' }[status] || 'neutral';
}
function rowLabel(status) {
  return { new: 'New', existing: 'Exists', duplicate_in_file: 'Duplicate', invalid: 'Invalid' }[status] || status;
}
function outcomeTone(outcome) {
  return { imported: 'ok', updated: 'info', skipped: 'warn', failed: 'danger' }[outcome] || 'neutral';
}
