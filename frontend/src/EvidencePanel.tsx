import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from './api/auth';
import { ApiError } from './api/client';
import { deleteEvidence, evidenceBlob, listEvidence, updateEvidence, uploadEvidence } from './api/evidence';
import type { Evidence, EvidenceTarget } from './api/evidence';
import { clearUploadKey, EvidenceGate, EvidenceUrls, evidencePermissions, uploadFingerprint, uploadKey, validateEvidenceFile } from './evidence-state';
import './evidence.css';
type Props = { token: string; user: User; projectId: string; target: EvidenceTarget; onSignOut: () => void };
function Thumbnail({ token, projectId, row, onError }: { token: string; projectId: string; row: Evidence; onError: (e: unknown) => void }) {
  const [url, setUrl] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; const urls = new EvidenceUrls(); setUrl(''); setFailed(false);
    if (row.mimeType.startsWith('image/')) void evidenceBlob(token, projectId, row.id, true).then(blob => {
      if (active) setUrl(urls.create(blob));
    }).catch(e => { if (active) { setFailed(true); onError(e); } });
    return () => { active = false; urls.clear(); };
  }, [token, projectId, row.id, onError, row.mimeType]);
  return url ? <img className="evidence-thumb" src={url} alt={`Minh chứng ${row.originalName}`} /> : <span className="evidence-file-mark">{failed ? 'Ảnh chưa tải được' : row.mimeType === 'application/pdf' ? 'PDF' : 'Đang tải ảnh…'}</span>;
}
export default function EvidencePanel(props: Props) {
  const { user, target } = props;
  if (!evidencePermissions(user, target).read) return null;
  return <EvidenceContent key={JSON.stringify([props.projectId, target.kind, target.id, target.status, user.id, 'assigneeId' in target ? target.assigneeId : '', props.token])} {...props} />;
}
function EvidenceContent({ token, user, projectId, target, onSignOut }: Props) {
  const scope = JSON.stringify([projectId, target.kind, target.id, user.id]);
  const allowed = evidencePermissions(user, target);
  const mounted = useRef(true), busyRef = useRef(false), gate = useRef(new EvidenceGate()), blobGate = useRef(new EvidenceGate()), urls = useRef(new EvidenceUrls());
  const [rows, setRows] = useState<Evidence[] | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(false);
  const [file, setFile] = useState<File | null>(null), [caption, setCaption] = useState(''), [inputKey, setInputKey] = useState(0);
  const [editor, setEditor] = useState<{ kind: 'caption' | 'delete'; row: Evidence; text: string } | null>(null);
  const report = useCallback((e: unknown) => { if (!mounted.current) return; setError(e instanceof Error ? e.message : 'Không tải được minh chứng.'); if (e instanceof ApiError && e.status === 401) onSignOut(); }, [onSignOut]);
  const reload = useCallback(async (saved = false) => {
    const request = gate.current.begin(); blobGate.current.invalidate(); setLoading(true); setRows(null); setError(''); urls.current.clear();
    try { const next = await listEvidence(token, projectId, target); if (mounted.current && gate.current.current(request)) { setRows(next); setConflict(false); setEditor(old => { if (!old) return null; const row = next.find(r => r.id === old.row.id); return row ? { ...old, row } : null; }); } }
    catch (e) { if (mounted.current && gate.current.current(request)) { report(e); if (saved) setError('Đã lưu trên server nhưng chưa tải lại được. Chỉ tải lại danh sách, không gửi lại thao tác lưu.'); } }
    finally { if (mounted.current && gate.current.current(request)) setLoading(false); }
  // Target is immutable for the lifetime of this keyed component.
  }, [token, projectId, target.kind, target.id, report]);
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; gate.current.invalidate(); blobGate.current.invalidate(); urls.current.clear(); }; }, [reload]);
  async function write(action: () => Promise<unknown>, upload = false) {
    if (busyRef.current || !rows || conflict) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await action();
      if (!mounted.current) return;
      setEditor(null);
      if (upload) { clearUploadKey(scope); setFile(null); setCaption(''); setInputKey(k => k + 1); }
      setRows(null); setNotice('Đã lưu trên server.'); await reload(true);
    } catch (e) { if (mounted.current) { report(e); setConflict(e instanceof ApiError && e.status === 409); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function upload() {
    if (!file || busyRef.current) return;
    const chosen = file, note = caption;
    // Lock before hashing to prevent a double-click or draft changing mid-request.
    busyRef.current = true; setBusy(true);
    try {
      validateEvidenceFile(chosen, note); const fingerprint = await uploadFingerprint(chosen, note);
      if (!mounted.current) return;
      const key = uploadKey(scope, fingerprint); busyRef.current = false;
      await write(() => uploadEvidence(token, projectId, target, chosen, note, key), true);
    } catch (e) { report(e); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function download(row: Evidence) {
    const request = blobGate.current.begin();
    try { const blob = await evidenceBlob(token, projectId, row.id, false); if (!mounted.current || !blobGate.current.current(request)) return;
      const url = urls.current.create(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = row.originalName; anchor.click();
      setTimeout(() => urls.current.release(url), 1000);
    } catch (e) { if (mounted.current && blobGate.current.current(request)) report(e); }
  }
  return <section className="evidence-panel" aria-label="Minh chứng" aria-busy={busy || loading}>
    <h3>Minh chứng</h3><p className="form-hint">JPEG / PNG / PDF · tối đa 10 MiB/file · 20 file chưa xóa. Xóa mềm vẫn giữ file trên server.</p>
    {!allowed.write && <p>Hồ sơ đã khóa ghi. Bạn vẫn có thể xem và tải minh chứng theo quyền hiện tại.</p>}
    {notice && <p role="status" className="success-note">{notice}</p>}
    {error && <p role="alert" className="error-note">{error}</p>}
    <button type="button" className="button button-small button-quiet" disabled={busy || loading} onClick={() => void reload()}>Tải lại minh chứng</button>
    {loading ? <p role="status">Đang tải minh chứng…</p> : rows === null ? <p>Danh sách cũ đã ẩn. Chỉ thử lại GET bằng nút tải lại.</p> : <>
      <p>{rows.length}/20 file</p>{!rows.length && <p>Chưa có minh chứng.</p>}
      <div className="evidence-list">{rows.map(row => <article className="evidence-row" key={row.id}>
        <Thumbnail token={token} projectId={projectId} row={row} onError={report} />
        <div><strong>{row.originalName}</strong><p>{(row.sizeBytes / 1024).toFixed(1)} KiB · {row.mimeType}</p><p>{row.caption ?? 'Không có chú thích'}</p><p>{row.uploadedBy?.email ?? 'Người tải không còn trong danh sách'} · {new Date(row.createdAt).toLocaleString('vi-VN')}</p>
          <div className="evidence-actions"><button type="button" className="button button-small button-quiet" onClick={() => void download(row)}>Tải xuống</button>
          {allowed.write && (user.role === 'MANAGER' || row.uploadedBy?.id === user.id) && <><button type="button" disabled={busy} className="button button-small button-quiet" onClick={() => setEditor({ kind: 'caption', row, text: row.caption ?? '' })}>Sửa chú thích</button><button type="button" disabled={busy} className="button button-small button-quiet" onClick={() => setEditor({ kind: 'delete', row, text: '' })}>Xóa minh chứng</button></>}
          </div></div>
      </article>)}</div>
      {editor && <form className="form-stack evidence-form" onSubmit={e => { e.preventDefault(); if (editor.kind === 'delete' && !editor.text.trim()) { setError('Nhập lý do xóa.'); return; } void write(() => editor.kind === 'caption' ? updateEvidence(token, projectId, editor.row, editor.text.trim() || null) : deleteEvidence(token, projectId, editor.row, editor.text)); }}>
        <label>{editor.kind === 'caption' ? 'Chú thích minh chứng' : 'Lý do xóa minh chứng'}<textarea aria-label={editor.kind === 'caption' ? 'Chú thích minh chứng' : 'Lý do xóa minh chứng'} autoFocus maxLength={1000} required={editor.kind === 'delete'} disabled={busy} value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })} /></label>
        <p>{editor.row.originalName}{editor.kind === 'delete' && ' — file chỉ bị ẩn, chưa xóa khỏi disk.'}</p><div className="evidence-actions"><button className="button button-small" disabled={busy || conflict}>Xác nhận</button><button type="button" disabled={busy} className="button button-small button-quiet" onClick={() => setEditor(null)}>Hủy</button></div>
      </form>}
      {allowed.write && <form className="form-stack evidence-form" onSubmit={e => { e.preventDefault(); void upload(); }}>
        <label>File minh chứng<input key={inputKey} type="file" accept="image/jpeg,image/png,application/pdf" required disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        <label>Chú thích file<textarea aria-label="Chú thích file" maxLength={1000} disabled={busy} value={caption} onChange={e => setCaption(e.target.value)} /></label>
        <div className="evidence-actions"><button className="button button-small" disabled={busy || conflict || !file || rows.length >= 20}>{busy ? 'Đang lưu…' : 'Tải minh chứng lên'}</button><button type="button" disabled={busy} className="button button-small button-quiet" onClick={() => { clearUploadKey(scope); setFile(null); setCaption(''); setInputKey(k => k + 1); }}>Upload mới</button></div>
      </form>}
    </>}
  </section>;
}
