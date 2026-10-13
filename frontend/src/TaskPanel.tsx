import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from './api/auth';
import { ApiError } from './api/client';
import type { ProjectArea, ProjectSystem } from './api/projects';
import {
  approveTask, createTask, listTasks, listTechnicians, returnTask, startTask, submitTask, updateTask,
} from './api/tasks';
import type { ProjectTask, TaskInput, TaskStatus, Technician } from './api/tasks';
import ListView from './ListView';
import { useDialogFocus } from './useDialogFocus';
import EvidencePanel from './EvidencePanel';

interface Props {
  token: string;
  user: User;
  projectId: string;
  systems: ProjectSystem[];
  areas: ProjectArea[];
  onSignOut: () => void;
}

type TaskEditor = ProjectTask | 'new' | null;
type NoteAction = { task: ProjectTask; kind: 'submit' | 'return' } | null;

const statusLabels: Record<TaskStatus, string> = {
  ASSIGNED: 'Đã giao',
  IN_PROGRESS: 'Đang thực hiện',
  SUBMITTED: 'Chờ duyệt',
  RETURNED: 'Cần làm lại',
  APPROVED: 'Đã duyệt',
};
const REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.';
const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function messageOf(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) {
    return 'Công việc đã thay đổi trạng thái hoặc mã bị trùng. Tải lại danh sách rồi thử lại.';
  }
  return cause instanceof Error ? cause.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
}

function TaskDialog({ title, error, busy, onClose, children }: {
  title: string; error: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useDialogFocus(title);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  return <div className="modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
      <div className="modal-heading"><h2 id="task-dialog-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Đóng">×</button></div>
      {error && <div className="error-note modal-error" role="alert">{error}</div>}
      {children}
    </section>
  </div>;
}

function TaskForm({ initial, systems, areas, technicians, busy, onCancel, onSave }: {
  initial: TaskEditor; systems: ProjectSystem[]; areas: ProjectArea[]; technicians: Technician[];
  busy: boolean; onCancel: () => void; onSave: (input: TaskInput) => void;
}) {
  const existing = initial && initial !== 'new' ? initial : null;
  const [code, setCode] = useState(existing?.code ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [systemId, setSystemId] = useState(existing?.systemId ?? '');
  const [areaId, setAreaId] = useState(existing?.areaId ?? '');
  const [assigneeId, setAssigneeId] = useState(existing && technicians.some(tech => tech.id === existing.assigneeId) ? existing.assigneeId : '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [fieldError, setFieldError] = useState('');
  const unavailableAssignee = Boolean(existing && !technicians.some(tech => tech.id === existing.assigneeId));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalizedCode)) { setFieldError('Mã chỉ gồm chữ, số và dấu gạch ngang.'); return; }
    if (!title.trim()) { setFieldError('Nhập tên công việc.'); return; }
    if (!systemId || !assigneeId) { setFieldError('Chọn hạng mục và kỹ thuật viên.'); return; }
    setFieldError('');
    onSave({ code: normalizedCode, title: title.trim(), systemId, areaId: areaId || null,
      assigneeId, description: description.trim() || null });
  }

  return <form className="form-stack task-form" onSubmit={submit} aria-busy={busy}>
    <div className="form-grid">
      <label>Mã công việc<input value={code} onChange={event => setCode(event.target.value)} maxLength={40} required placeholder="VD: CV-LAN-01" /></label>
      <label>Tên công việc<input value={title} onChange={event => setTitle(event.target.value)} required placeholder="VD: Kéo dây mạng tầng 1" /></label>
    </div>
    <div className="form-grid">
      <label>Hạng mục<select required value={systemId} onChange={event => setSystemId(event.target.value)}>
        <option value="">Chọn hạng mục</option>
        {systems.map(system => <option key={system.id} value={system.id}>{system.name} · {system.category}</option>)}
      </select></label>
      <label>Khu vực<select value={areaId} onChange={event => setAreaId(event.target.value)}>
        <option value="">Toàn công trình / chưa gắn khu vực</option>
        {areas.map(area => <option key={area.id} value={area.id}>{area.type === 'FLOOR' ? 'Tầng' : 'Phòng'}: {area.name} · {area.code}</option>)}
      </select></label>
    </div>
    <label>Kỹ thuật viên<select required value={assigneeId} onChange={event => setAssigneeId(event.target.value)}>
      <option value="">Chọn kỹ thuật viên active</option>
      {technicians.map(tech => <option key={tech.id} value={tech.id}>{tech.email}</option>)}
    </select></label>
    {unavailableAssignee && <p className="form-hint">Người được giao trước đây không còn active. Hãy chọn kỹ thuật viên khác.</p>}
    <label>Mô tả<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Phạm vi hoặc lưu ý thi công" /></label>
    {fieldError && <div className="error-note modal-error" role="alert">{fieldError}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : existing ? 'Lưu công việc' : 'Giao việc'}</button></div>
  </form>;
}

function TaskNoteForm({ kind, busy, onCancel, onSave }: {
  kind: 'submit' | 'return'; busy: boolean; onCancel: () => void; onSave: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!note.trim()) { setFieldError(kind === 'submit' ? 'Nhập ghi chú hoàn thành trước khi gửi duyệt.' : 'Nhập lý do trả việc.'); return; }
    setFieldError(''); onSave(note.trim());
  };
  return <form className="form-stack task-form" onSubmit={submit} aria-busy={busy}>
    <label>{kind === 'submit' ? 'Ghi chú hoàn thành' : 'Lý do trả việc'}
      <textarea rows={4} required value={note} onChange={event => setNote(event.target.value)} placeholder={kind === 'submit' ? 'Đã thực hiện và kiểm tra những gì?' : 'Cần bổ sung hoặc khắc phục điều gì?'} />
    </label>
    {fieldError && <div className="error-note modal-error" role="alert">{fieldError}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : kind === 'submit' ? 'Gửi duyệt' : 'Trả việc'}</button></div>
  </form>;
}

export default function TaskPanel({ token, user, projectId, systems, areas, onSignOut }: Props) {
  const manager = user.role === 'MANAGER';
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTechnicians, setLoadingTechnicians] = useState(manager);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState('');
  const [techniciansError, setTechniciansError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<TaskEditor>(null);
  const [viewed, setViewed] = useState<ProjectTask | null>(null);
  const [noteAction, setNoteAction] = useState<NoteAction>(null);
  const [modalError, setModalError] = useState('');
  const taskRequest = useRef(0);
  const technicianRequest = useRef(0);

  const reloadTasks = useCallback(async (failureMessage?: string): Promise<boolean> => {
    const requestId = ++taskRequest.current;
    setLoading(true); setError('');
    try {
      const rows = await listTasks(token, projectId);
      if (requestId === taskRequest.current) { setTasks(rows); setRefreshFailed(false); }
      return requestId === taskRequest.current;
    } catch (cause) {
      if (requestId === taskRequest.current) { setError(failureMessage ?? messageOf(cause)); setRefreshFailed(true); setNotice(''); }
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      return false;
    } finally { if (requestId === taskRequest.current) setLoading(false); }
  }, [token, projectId, onSignOut]);

  const reloadTechnicians = useCallback(async () => {
    if (!manager) return;
    const requestId = ++technicianRequest.current;
    setLoadingTechnicians(true); setTechniciansError('');
    try {
      const rows = await listTechnicians(token);
      if (requestId === technicianRequest.current) setTechnicians(rows);
    } catch (cause) {
      if (requestId === technicianRequest.current) setTechniciansError(messageOf(cause));
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
    } finally { if (requestId === technicianRequest.current) setLoadingTechnicians(false); }
  }, [manager, token, onSignOut]);

  useEffect(() => {
    void reloadTasks();
    if (manager) void reloadTechnicians();
    return () => { taskRequest.current++; technicianRequest.current++; };
  }, [reloadTasks, reloadTechnicians, manager]);

  async function runWrite(write: () => Promise<ProjectTask>, success: string, close?: () => void) {
    if (busy || refreshFailed) return;
    setBusy(true); setError(''); setModalError(''); setNotice('');
    try { await write(); }
    catch (cause) {
      if (close) setModalError(messageOf(cause)); else setError(messageOf(cause));
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      setBusy(false);
      return;
    }
    close?.();
    if (await reloadTasks(REFRESH_FAILED)) setNotice(success);
    setBusy(false);
  }

  const techniciansReady = !loadingTechnicians && !techniciansError;
  const openEditor = (value: TaskEditor) => {
    if (!techniciansReady) return;
    setEditor(value); setModalError(''); setError('');
  };
  const openNote = (task: ProjectTask, kind: 'submit' | 'return') => { setNoteAction({ task, kind }); setModalError(''); setError(''); };
  const systemName = (id: string) => systems.find(system => system.id === id)?.name ?? 'Hạng mục không còn trong danh sách';
  const areaName = (id: string | null) => id ? areas.find(area => area.id === id)?.name ?? 'Khu vực không còn trong danh sách' : 'Toàn công trình';
  const assigneeName = (id: string) => {
    if (id === user.id) return user.email;
    if (loadingTechnicians) return 'Đang tải kỹ thuật viên…';
    if (techniciansError) return 'Chưa tải được kỹ thuật viên';
    return technicians.find(tech => tech.id === id)?.email ?? 'Tài khoản không còn active';
  };
  const canCreate = manager && techniciansReady && technicians.length > 0 && systems.length > 0;

  return <section className="tasks-panel" aria-busy={busy || loading} aria-label="Công việc thi công">
    <div className="panel-heading task-panel-heading">
      <div><span className="section-kicker">Theo dõi thực hiện</span><h3>Công việc</h3></div>
      {manager && <button className="button button-small" disabled={!canCreate || loading || refreshFailed || busy} onClick={() => openEditor('new')}>＋ Giao việc</button>}
    </div>
    <div className="task-summary">{loading ? 'Đang tải công việc…' : manager ? `${tasks.length} công việc trong công trình` : `${tasks.length} việc được giao cho bạn`}</div>
    {manager && techniciansError && <div className="inline-error" role="alert">Không tải được danh sách kỹ thuật viên: {techniciansError}<button onClick={() => void reloadTechnicians()}>Thử lại</button></div>}
    {manager && !loadingTechnicians && !techniciansError && technicians.length === 0 && <p className="task-guidance">Chưa có kỹ thuật viên active để giao việc.</p>}
    {manager && systems.length === 0 && <p className="task-guidance">Thêm hạng mục hệ thống trước khi giao việc.</p>}
    {notice && <div className="success-note" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button></div>}
    {error && <div className="error-note" role="alert">{error}{refreshFailed ? <button className="retry-inline" onClick={() => void reloadTasks()}>Tải lại công việc</button> : <button onClick={() => setError('')} aria-label="Đóng thông báo">×</button>}</div>}
    {loading ? <div className="task-loading" role="status"><span className="spinner" />Đang tải danh sách công việc…</div> : refreshFailed ? <div className="task-unavailable">Danh sách cũ đã được ẩn để tránh thao tác lặp. Hãy tải lại công việc hoặc tải lại trang.</div> : tasks.length === 0 ?
      <div className="empty-panel task-empty"><span className="empty-mark">✓</span><h4>{manager ? 'Chưa có công việc' : 'Bạn chưa được giao việc'}</h4><p>{manager ? 'Giao công việc đầu tiên sau khi đã có hạng mục và kỹ thuật viên.' : 'Khi được giao việc, bạn sẽ thấy công việc tại đây.'}</p>{canCreate && <button className="text-button" onClick={() => openEditor('new')}>Giao công việc đầu tiên</button>}</div> :
      <ListView rows={tasks} label="công việc" className="task-list" text={t => `${t.code} ${t.title} ${systemName(t.systemId)} ${areaName(t.areaId)} ${assigneeName(t.assigneeId)}`} kind={t => statusLabels[t.status]}>{task => <li className={`task-row task-status-${task.status.toLowerCase()}`} key={task.id}>
        <div className="task-main"><div className="task-title"><span className="task-code">{task.code}</span><h4>{task.title}</h4></div><span className="task-state">{statusLabels[task.status]}</span></div>
        <div className="task-meta"><span><strong>Hạng mục</strong>{systemName(task.systemId)}</span><span><strong>Khu vực</strong>{areaName(task.areaId)}</span>{manager && <span><strong>Kỹ thuật viên</strong>{assigneeName(task.assigneeId)}</span>}</div>
        <button className="text-button" onClick={() => setViewed(task)}>Xem chi tiết</button>
        <div className="task-actions">
          {manager && (task.status === 'ASSIGNED' || task.status === 'RETURNED') && <button className="button button-small button-quiet" disabled={busy || !techniciansReady} onClick={() => openEditor(task)}>Sửa / giao lại</button>}
          {manager && task.status === 'SUBMITTED' && <><button className="button button-small" disabled={busy} onClick={() => { if (window.confirm(`Duyệt công việc “${task.title}”?`)) void runWrite(() => approveTask(token, projectId, task.id), 'Đã duyệt công việc.'); }}>Duyệt</button><button className="button button-small button-quiet" disabled={busy} onClick={() => openNote(task, 'return')}>Trả việc</button></>}
          {!manager && (task.status === 'ASSIGNED' || task.status === 'RETURNED') && <button className="button button-small" disabled={busy} onClick={() => void runWrite(() => startTask(token, projectId, task.id), 'Đã bắt đầu công việc.')}>Bắt đầu</button>}
          {!manager && task.status === 'IN_PROGRESS' && <button className="button button-small" disabled={busy} onClick={() => openNote(task, 'submit')}>Gửi duyệt</button>}
        </div>
      </li>}</ListView>}

    {viewed && <TaskDialog title={viewed.title} error="" busy={false} onClose={() => setViewed(null)}><p>{viewed.code} — {statusLabels[viewed.status]}</p><p>{viewed.description || 'Không có mô tả'}</p><p>Ghi chú hoàn thành: {viewed.completionNote || 'Chưa có'}</p><p>Lý do trả việc: {viewed.returnReason || 'Không có'}</p><EvidencePanel token={token} user={user} projectId={projectId} target={{ kind: 'task', id: viewed.id, status: viewed.status, assigneeId: viewed.assigneeId }} onSignOut={onSignOut} /></TaskDialog>}
    {editor && <TaskDialog title={editor === 'new' ? 'Giao công việc' : 'Sửa công việc'} error={modalError} busy={busy} onClose={() => setEditor(null)}>
      <TaskForm initial={editor} systems={systems} areas={areas} technicians={technicians} busy={busy} onCancel={() => setEditor(null)} onSave={input => void runWrite(
        () => editor === 'new' ? createTask(token, projectId, input) : updateTask(token, projectId, editor.id, input),
        editor === 'new' ? 'Đã giao công việc.' : 'Đã lưu công việc.', () => setEditor(null),
      )} />
    </TaskDialog>}
    {noteAction && <TaskDialog title={noteAction.kind === 'submit' ? 'Gửi công việc để duyệt' : 'Trả công việc'} error={modalError} busy={busy} onClose={() => setNoteAction(null)}>
      <TaskNoteForm kind={noteAction.kind} busy={busy} onCancel={() => setNoteAction(null)} onSave={note => void runWrite(
        () => noteAction.kind === 'submit' ? submitTask(token, projectId, noteAction.task.id, note) : returnTask(token, projectId, noteAction.task.id, note),
        noteAction.kind === 'submit' ? 'Đã gửi công việc để duyệt.' : 'Đã trả công việc.', () => setNoteAction(null),
      )} />
    </TaskDialog>}
  </section>;
}
