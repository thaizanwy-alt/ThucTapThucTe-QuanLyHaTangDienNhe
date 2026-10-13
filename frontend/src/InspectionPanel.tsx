import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from './api/auth';
import { ApiError } from './api/client';
import { listDevices } from './api/devices';
import type { ProjectDevice } from './api/devices';
import type { ProjectArea, ProjectSystem } from './api/projects';
import { listTechnicians } from './api/tasks';
import type { Technician } from './api/tasks';
import { assignIssue, createInspection, getInspection, getIssue, listInspections, listIssues, listTemplates, putResult, recheckIssue, resolveIssue, startIssue } from './api/inspections';
import type { ChecklistTemplate, Inspection, InspectionInput, InspectionResult, IssueDetail, ItemDetail } from './api/inspections';
import { inspectionPayload, InspectionRequestGate, issueActions, issueLabels, recheckPayload, resultLabels, resultPayload, SAVED_REFRESH_FAILED, saveInspectionAndRefresh } from './inspection-form';
import type { InspectionDraft } from './inspection-form';
import './inspection.css';
import ListView from './ListView';

interface Props { token: string; user: User; projectId: string; areas: ProjectArea[]; systems: ProjectSystem[]; deviceRevision: number; onSignOut: () => void }
interface Snapshot { scope: string; sheets: Inspection[]; issues: IssueDetail[]; templates: ChecklistTemplate[]; devices: ProjectDevice[]; technicians: Technician[] }
type Editor = { kind: 'create' } | { kind: 'sheet'; sheet: Inspection } | { kind: 'issue'; issue: IssueDetail }
  | { kind: 'result'; sheetId: string; item: ItemDetail } | { kind: 'assign' | 'recheck' | 'resolve' | 'start'; issue: IssueDetail };
function messageOf(e: unknown) {
  if (e instanceof ApiError && e.status === 409) return 'Lỗi 409: Phiên bản hoặc dữ liệu đã thay đổi. Tải lại dữ liệu trước khi lưu tiếp; nội dung đã nhập vẫn được giữ.';
  return e instanceof Error ? e.message : 'Không tải được hồ sơ kiểm tra.';
}
function InspectionDialog({ kind, title, busy, onClose, children }: { kind: string; title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => { (ref.current?.querySelector<HTMLElement>('form input, form select, form textarea') ?? ref.current)?.focus(); }, [kind]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') ?? []);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { e.preventDefault(); ref.current?.focus(); }
      else if (!nodes.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [busy, onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} tabIndex={-1} className="modal inspection-dialog" role="dialog" aria-modal="true" aria-labelledby="inspection-dialog-title">
      <div className="modal-heading"><h2 id="inspection-dialog-title">{title}</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Đóng">×</button></div>{children}
    </section></div>;
}
function CreateForm({ data, systems, areas, busy, onSave }: { data: Snapshot; systems: ProjectSystem[]; areas: ProjectArea[]; busy: boolean; onSave: (input: InspectionInput) => void }) {
  const [draft, setDraft] = useState<InspectionDraft>({ code: '', title: '', systemId: '', templateId: '', scope: 'none', scopeId: '' });
  const [error, setError] = useState('');
  const category = systems.find(s => s.id === draft.systemId)?.category;
  return <form className="form-stack" onSubmit={e => { e.preventDefault(); try {
    const input = inspectionPayload(draft, systems, data.templates, data.devices, areas.map(a => a.id));
    setError(''); onSave(input);
  } catch (cause) { setError(messageOf(cause)); } }}>
    {error && <p role="alert" className="error-note">{error}</p>}
    <label>Mã phiếu<input required value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} /></label>
    <label>Tên phiếu<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
    <label>System<select aria-label="System" required value={draft.systemId} onChange={e => setDraft({ ...draft, systemId: e.target.value, templateId: '', scopeId: '' })}><option value="">Chọn hệ thống</option>{systems.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}</select></label>
    <label>Mẫu checklist<select aria-label="Mẫu checklist" required value={draft.templateId} onChange={e => setDraft({ ...draft, templateId: e.target.value })}><option value="">Chọn mẫu đúng loại</option>{data.templates.filter(t => t.isActive && t.category === category).map(t => <option key={t.id} value={t.id}>{t.name} (revision {t.revision})</option>)}</select></label>
    <label>Phạm vi<select aria-label="Phạm vi" value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value as InspectionDraft['scope'], scopeId: '' })}><option value="none">Không gắn vị trí</option><option value="area">Khu vực</option><option value="device">Thiết bị</option></select></label>
    {draft.scope !== 'none' && <label>{draft.scope === 'area' ? 'Khu vực' : 'Thiết bị'}<select aria-label={draft.scope === 'area' ? 'Khu vực' : 'Thiết bị'} required value={draft.scopeId} onChange={e => setDraft({ ...draft, scopeId: e.target.value })}><option value="">Chọn phạm vi</option>{(draft.scope === 'area' ? areas : data.devices.filter(d => d.systemIds.includes(draft.systemId))).map(v => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}</select></label>}
    <p className="inspection-help">Nội dung mẫu được sao chép vào phiếu. Thay đổi danh mục sau này không sửa snapshot.</p>
    <button className="button" disabled={busy}>Tạo phiếu</button>
  </form>;
}
function ResultForm({ item, technicians, busy, submit }: { item: ItemDetail; technicians: Technician[]; busy: boolean; submit: (input: ReturnType<typeof resultPayload>) => void }) {
  const [result, setResult] = useState<InspectionResult>(item.result);
  const [note, setNote] = useState(item.note ?? ''); const [description, setDescription] = useState(''); const [assignee, setAssignee] = useState(''); const [error, setError] = useState('');
  return <form className="form-stack" onSubmit={e => { e.preventDefault(); try { submit(resultPayload(item, result, note, description, assignee, technicians)); setError(''); } catch (cause) { setError(messageOf(cause)); } }}>
    <p>{item.code} — {item.title}</p>{item.instruction && <p>{item.instruction}</p>}
    {error && <p role="alert" className="error-note">{error}</p>}
    <label>Kết quả<select aria-label="Kết quả" value={result} onChange={e => setResult(e.target.value as InspectionResult)}>{Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value} disabled={!!item.activeIssue && value !== 'FAIL'}>{label}</option>)}</select></label>
    <label>Ghi chú mục<textarea aria-label="Ghi chú mục" value={note} onChange={e => setNote(e.target.value)} /></label>
    {item.activeIssue ? <p>Lỗi đang mở: {issueLabels[item.activeIssue.status]}. Không tạo lỗi thứ hai; đổi PASS cần recheck.</p> : result === 'FAIL' && <>
      <label>Mô tả lỗi<textarea aria-label="Mô tả lỗi" required value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label>Kỹ thuật viên<select aria-label="Kỹ thuật viên" required value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Chọn người khắc phục</option>{technicians.map(t => <option key={t.id} value={t.id}>{t.email}</option>)}</select></label>
    </>}
    <button className="button" disabled={busy}>Lưu kết quả</button>
  </form>;
}
function IssueForm({ editor, technicians, busy, submit }: { editor: Extract<Editor, { issue: IssueDetail }>; technicians: Technician[]; busy: boolean; submit: (fields: { assignee: string; note: string; reason: string; result: 'PASS' | 'FAIL' }) => void }) {
  const [assignee, setAssignee] = useState(editor.issue.assigneeId); const [note, setNote] = useState(''); const [reason, setReason] = useState(''); const [result, setResult] = useState<'PASS' | 'FAIL'>('PASS');
  return <form className="form-stack" onSubmit={e => { e.preventDefault(); submit({ assignee, note, reason, result }); }}>
    <p>{editor.issue.description}</p>
    {editor.kind === 'assign' && <label>Kỹ thuật viên<select aria-label="Kỹ thuật viên" required value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Chọn người khắc phục</option>{!technicians.some(t => t.id === assignee) && <option value={assignee} disabled>Người được giao không còn active</option>}{technicians.map(t => <option key={t.id} value={t.id}>{t.email}</option>)}</select></label>}
    {editor.kind === 'recheck' && <label>Kết quả kiểm tra lại<select aria-label="Kết quả kiểm tra lại" value={result} onChange={e => setResult(e.target.value as 'PASS' | 'FAIL')}><option value="PASS">Đạt — đóng lỗi</option><option value="FAIL">Không đạt — trả lỗi</option></select></label>}
    {(editor.kind === 'recheck' || editor.kind === 'resolve') && <label>{editor.kind === 'resolve' ? 'Ghi chú khắc phục' : 'Ghi chú kiểm tra lại'}<textarea aria-label={editor.kind === 'resolve' ? 'Ghi chú khắc phục' : 'Ghi chú kiểm tra lại'} required value={note} onChange={e => setNote(e.target.value)} /></label>}
    {editor.kind === 'recheck' && result === 'FAIL' && <label>Lý do trả lỗi<textarea aria-label="Lý do trả lỗi" required value={reason} onChange={e => setReason(e.target.value)} /></label>}
    <button className="button" disabled={busy}>{editor.kind === 'start' ? 'Bắt đầu sửa' : editor.kind === 'resolve' ? 'Báo đã sửa' : editor.kind === 'assign' ? 'Giao lại lỗi' : 'Lưu kiểm tra lại'}</button>
  </form>;
}

export default function InspectionPanel({ token, user, projectId, areas, systems, deviceRevision, onSignOut }: Props) {
  const manager = user.role === 'MANAGER'; const scope = JSON.stringify([projectId, deviceRevision]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const mounted = useRef(true);
  const gate = useRef(new InspectionRequestGate());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const data = snapshot?.scope === scope ? snapshot : null;
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [editor, setEditor] = useState<Editor | null>(null); const [formError, setFormError] = useState(''); const [conflict, setConflict] = useState(false); const [tab, setTab] = useState<'sheets' | 'issues'>('sheets');
  const refresh = useCallback(async (failure = '') => {
    const request = gate.current.begin(); setLoading(true); setSnapshot(null); setError('');
    try {
      const [issues, devices, sheets, templates, technicians] = await Promise.all([listIssues(token, projectId), listDevices(token, projectId), manager ? listInspections(token, projectId) : Promise.resolve([]), manager ? listTemplates(token) : Promise.resolve([]), manager ? listTechnicians(token) : Promise.resolve([])]);
      if (!gate.current.current(request) || scopeRef.current !== scope) return false;
      setSnapshot({ scope, sheets, issues, templates, devices, technicians }); return true;
    } catch (cause) {
      if (gate.current.current(request) && scopeRef.current === scope) setError(failure || messageOf(cause));
      if (gate.current.current(request) && scopeRef.current === scope && cause instanceof ApiError && cause.status === 401) onSignOut(); return false;
    } finally { if (gate.current.current(request) && scopeRef.current === scope) setLoading(false); }
  }, [token, projectId, manager, scope, onSignOut]);
  useEffect(() => { mounted.current = true; setEditor(null); setBusy(false); setNotice(''); void refresh(); return () => { mounted.current = false; gate.current.invalidate(); }; }, [refresh]);
  const close = () => { if (!busy) { setEditor(null); setFormError(''); setConflict(false); } };
  const open = (value: Editor) => { setEditor(value); setFormError(''); setConflict(false); };
  async function write(action: () => Promise<unknown>) {
    if (busy || !data || conflict) return;
    const currentScope = scope; setBusy(true); setFormError(''); setNotice('');
    try {
      const refreshed = await saveInspectionAndRefresh(action, () => {
        if (mounted.current && scopeRef.current === currentScope) { setEditor(null); setSnapshot(null); gate.current.invalidate(); }
      }, () => mounted.current && scopeRef.current === currentScope ? refresh(SAVED_REFRESH_FAILED) : Promise.resolve(false));
      if (refreshed && mounted.current && scopeRef.current === currentScope) setNotice('Đã lưu và tải lại hồ sơ kiểm tra.');
    } catch (cause) {
      if (mounted.current && scopeRef.current === currentScope) { setFormError(messageOf(cause)); setConflict(cause instanceof ApiError && cause.status === 409); if (cause instanceof ApiError && cause.status === 401) onSignOut(); }
    } finally { if (mounted.current && scopeRef.current === currentScope) setBusy(false); }
  }
  async function refreshVersion() {
    if (!editor || busy) return; setBusy(true); const currentScope = scope;
    try {
      let next = editor;
      if (editor.kind === 'result') {
        const latest = await getInspection(token, projectId, editor.sheetId); const item = latest.items.find(i => i.id === editor.item.id);
        if (!item) throw new ApiError(404, 'Mục không còn trong phiếu.'); next = { ...editor, item };
      } else if ('issue' in editor) next = { ...editor, issue: await getIssue(token, projectId, editor.issue.id) };
      else if (editor.kind === 'create') {
        const [templates, devices, technicians] = await Promise.all([listTemplates(token), listDevices(token, projectId), listTechnicians(token)]);
        if (mounted.current && scopeRef.current === currentScope) setSnapshot(old => old ? { ...old, templates, devices, technicians } : old);
      }
      if (mounted.current && scopeRef.current === currentScope) { setEditor(next); setConflict(false); setFormError('Đã tải phiên bản mới. Kiểm tra nội dung trước khi lưu tiếp.'); }
    } catch (cause) { if (mounted.current && scopeRef.current === currentScope) { setFormError(messageOf(cause)); if (cause instanceof ApiError && cause.status === 401) onSignOut(); } }
    finally { if (mounted.current && scopeRef.current === currentScope) setBusy(false); }
  }
  const context = (v: { systemId: string; areaId: string | null; deviceId: string | null }) => `${systems.find(s => s.id === v.systemId)?.code ?? 'System không còn trong danh mục'} / ${v.deviceId ? data?.devices.find(d => d.id === v.deviceId)?.code ?? 'Thiết bị không còn trong danh mục' : v.areaId ? areas.find(a => a.id === v.areaId)?.code ?? 'Khu vực không còn trong danh mục' : 'Không gắn vị trí'}`;
  const actionButtons = (issue: IssueDetail) => { const allowed = issueActions(user, issue); return <div className="inspection-actions">
    {allowed.assign && <button className="button button-small button-quiet" onClick={() => open({ kind: 'assign', issue })}>Giao lại</button>}
    {allowed.recheck && <button className="button button-small" onClick={() => open({ kind: 'recheck', issue })}>Kiểm tra lại</button>}
    {allowed.start && <button className="button button-small" onClick={() => open({ kind: 'start', issue })}>Bắt đầu sửa</button>}
    {allowed.resolve && <button className="button button-small" onClick={() => open({ kind: 'resolve', issue })}>Báo đã sửa</button>}
  </div>; };
  const titles = { create: 'Tạo phiếu kiểm tra', sheet: 'Chi tiết phiếu', issue: 'Chi tiết lỗi', result: 'Ghi kết quả mục', assign: 'Giao lại lỗi', recheck: 'Kiểm tra lại lỗi', resolve: 'Báo đã sửa', start: 'Bắt đầu sửa' };
  return <section className="inspection-panel" aria-busy={busy || loading} aria-label={manager ? 'Kiểm tra' : 'Lỗi được giao'}>
    <div className="panel-heading"><div><h3>{manager ? 'Kiểm tra' : 'Lỗi được giao'}</h3><p className="inspection-help">Hồ sơ kiểm tra thực tế; báo đã sửa chưa có nghĩa là đạt.</p></div>{manager && <button className="button button-small" disabled={!data || busy || !systems.length || !data.templates.length} onClick={() => open({ kind: 'create' })}>＋ Tạo phiếu</button>}</div>
    {manager && <div className="inspection-tabs"><button className="button button-small button-quiet" aria-pressed={tab === 'sheets'} onClick={() => setTab('sheets')}>Phiếu kiểm tra</button><button className="button button-small button-quiet" aria-pressed={tab === 'issues'} onClick={() => setTab('issues')}>Lỗi khắc phục</button></div>}
    {notice && <p role="status" className="success-note">{notice}</p>}
    {error && <div role="alert" className="error-note">{error}<button className="retry-inline" onClick={() => void refresh()}>Tải lại hồ sơ</button></div>}
    {loading ? <p role="status">Đang tải hồ sơ kiểm tra…</p> : !data ? <p>Dữ liệu cũ đã ẩn. Thử tải lại bằng GET; không gửi lại thao tác lưu.</p> : manager && tab === 'sheets' ? <>
      {!data.sheets.length && <div className="empty-panel"><h4>Chưa có phiếu kiểm tra</h4><p>Chọn System và mẫu để ghi nhận kết quả thực tế.</p></div>}
      <ListView container="div" rows={data.sheets} label="phiếu" className="inspection-list" text={s => `${s.code} ${s.title} ${context(s)}`} kind={s => s.passed ? 'Đạt' : 'Chưa đạt'}>{sheet => <button className="inspection-sheet" key={sheet.id} onClick={() => open({ kind: 'sheet', sheet })}><strong>{sheet.code} — {sheet.title}</strong><span>{context(sheet)}</span><span>{sheet.passed ? 'Phiếu đạt' : 'Phiếu chưa đạt'} · {sheet.summary.pass}/{sheet.summary.total} mục đạt · {sheet.summary.openIssues} lỗi chưa đóng</span></button>}</ListView>
    </> : <><p>{data.issues.length} lỗi {manager ? 'trong công trình' : 'được giao cho bạn'} (gồm lịch sử đã đóng)</p>{!data.issues.length && <div className="empty-panel">Chưa có lỗi được ghi nhận.</div>}<ListView container="div" rows={data.issues} label="lỗi" className="inspection-list" text={i => `${i.inspectionCode} ${i.item.code} ${i.description} ${context(i)}`} kind={i => issueLabels[i.status]}>{issue => <article key={issue.id} className="inspection-issue"><button className="text-button" onClick={() => open({ kind: 'issue', issue })}>{issue.inspectionCode} / {issue.item.code} — {issue.description}</button><span className={`inspection-state state-${issue.status.toLowerCase()}`}>{issueLabels[issue.status]}</span><p>{context(issue)} · {issue.assignee?.email ?? 'Tài khoản không còn trong danh sách'}</p>{actionButtons(issue)}</article>}</ListView></>}
    {editor && data && <InspectionDialog kind={editor.kind} title={titles[editor.kind]} busy={busy} onClose={close}>
      {formError && <div className="error-note" role="alert">{formError}{conflict && <button className="retry-inline" disabled={busy} onClick={() => void refreshVersion()}>Tải lại phiên bản</button>}</div>}
      {editor.kind === 'create' && <CreateForm data={data} systems={systems} areas={areas} busy={busy || conflict} onSave={input => void write(() => createInspection(token, projectId, input))} />}
      {editor.kind === 'sheet' && <><h3>{editor.sheet.code} — {editor.sheet.title}</h3><p>{context(editor.sheet)} · revision {editor.sheet.templateRevision}</p><p>{editor.sheet.passed ? 'Phiếu đạt' : 'Phiếu chưa đạt'}; đạt {editor.sheet.summary.pass}, không đạt {editor.sheet.summary.fail}, chưa kiểm tra {editor.sheet.summary.notChecked}; {editor.sheet.summary.openIssues} lỗi chưa đóng.</p>{editor.sheet.items.map(item => <article className="inspection-item" key={item.id}><h4>{item.code} — {item.title}</h4><p>{item.instruction}</p><p>{resultLabels[item.result]} · {item.note ?? 'Chưa có ghi chú'}</p><button className="button button-small button-quiet" onClick={() => open({ kind: 'result', sheetId: editor.sheet.id, item })}>Ghi kết quả</button><h5>Lịch sử lỗi ({item.issues.length})</h5>{item.issues.map(issue => <p key={issue.id}>{issueLabels[issue.status]} — {issue.description}{issue.resolutionNote ? ` / Đã sửa: ${issue.resolutionNote}` : ''}{issue.returnReason ? ` / Trả lỗi: ${issue.returnReason}` : ''} {data.issues.find(v => v.id === issue.id) && <button className="text-button" onClick={() => open({ kind: 'issue', issue: data.issues.find(v => v.id === issue.id)! })}>Xem lỗi</button>}</p>)}</article>)}</>}
      {editor.kind === 'issue' && <><h3>{editor.issue.description}</h3><p>{editor.issue.inspectionCode} / {editor.issue.item.code} — {editor.issue.item.title}</p><p>{context(editor.issue)}</p><p>{issueLabels[editor.issue.status]} · {editor.issue.assignee?.email}</p><p>Kết quả mục: {resultLabels[editor.issue.item.result]}</p>{editor.issue.resolutionNote && <p>Ghi chú khắc phục: {editor.issue.resolutionNote}</p>}{editor.issue.returnReason && <p>Lý do trả lỗi: {editor.issue.returnReason}</p>}{editor.issue.reviewedAt && <p>Đã kiểm tra/đóng: {new Date(editor.issue.reviewedAt).toLocaleString('vi-VN')}</p>}{editor.issue.status === 'CLOSED' ? <p>Lỗi đã đóng, không thể sửa.</p> : actionButtons(editor.issue)}</>}
      {editor.kind === 'result' && <ResultForm item={editor.item} technicians={data.technicians} busy={busy || conflict} submit={input => void write(() => putResult(token, projectId, editor.sheetId, editor.item.id, input))} />}
      {('issue' in editor && !['issue'].includes(editor.kind)) && <IssueForm key={`${editor.kind}:${editor.issue.id}`} editor={editor} technicians={data.technicians} busy={busy || conflict || !issueActions(user, editor.issue)[editor.kind as 'assign' | 'recheck' | 'resolve' | 'start']} submit={fields => {
        try {
          if (!issueActions(user, editor.issue)[editor.kind as 'assign' | 'recheck' | 'resolve' | 'start']) throw new Error('Trạng thái hoặc người được giao đã đổi; thao tác này không còn được phép.');
          let action: () => Promise<unknown>;
          if (editor.kind === 'recheck') { const input = recheckPayload(editor.issue, editor.issue.item.version, fields.result, fields.note, fields.reason); action = () => recheckIssue(token, projectId, editor.issue.id, input); }
          else if (editor.kind === 'assign') { if (!data.technicians.some(t => t.id === fields.assignee)) throw new Error('Chọn kỹ thuật viên active.'); action = () => assignIssue(token, projectId, editor.issue.id, editor.issue.version, fields.assignee); }
          else if (editor.kind === 'resolve') { if (!fields.note.trim()) throw new Error('Ghi chú khắc phục không được để trống.'); action = () => resolveIssue(token, projectId, editor.issue.id, editor.issue.version, fields.note.trim()); }
          else action = () => startIssue(token, projectId, editor.issue.id, editor.issue.version);
          void write(action);
        } catch (cause) { setFormError(messageOf(cause)); }
      }} />}
    </InspectionDialog>}
  </section>;
}
