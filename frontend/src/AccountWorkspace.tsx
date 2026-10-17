import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from './api/auth';
import { getMe } from './api/auth';
import { ApiError } from './api/client';
import { changePassword, createTechnician, listManagedTechnicians, resetTechnician, setTechnicianStatus } from './api/users';
import type { ManagedTechnician, OpenWork } from './api/users';
import { accountError, openWorkOf, passwordProblem } from './account-form';
import ListView from './ListView';
import { useDialogFocus } from './useDialogFocus';
import './account.css';

type Props = { token: string; user: User; mode: 'manage' | 'password'; onBack: () => void; onSignOut: () => void; onPasswordChanged: () => void };
type Editor = { kind: 'create' } | { kind: 'reset' | 'status'; row: ManagedTechnician };
const REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được. Chỉ thử tải lại danh sách; không gửi lại thao tác ghi.';

function Dialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useDialogFocus(title);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [busy, onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="modal account-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" tabIndex={-1}>
      <div className="modal-heading"><h2 id="account-dialog-title">{title}</h2><button className="icon-button" aria-label="Đóng" disabled={busy} onClick={onClose}>×</button></div>{children}
    </section>
  </div>;
}

export function PasswordForm({ token, user, onChanged }: { token: string; user: User; onChanged: () => void }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState('');
  const [version, setVersion] = useState(user.version), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(false), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (locked.current) return;
    const problem = passwordProblem(next) || (next !== confirm ? 'Hai lần nhập mật khẩu mới không khớp.' : '');
    if (problem) { setError(problem); return; }
    locked.current = true; setBusy(true); setError('');
    try {
      await changePassword(token, version, current, next);
      if (!alive.current) return;
      setCurrent(''); setNext(''); setConfirm(''); onChanged();
    } catch (cause) { if (alive.current) setError(accountError(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function reloadVersion() {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { const fresh = await getMe(token); if (alive.current) { setVersion(fresh.version); setError('Đã tải phiên bản mới. Kiểm tra nội dung rồi nhấn đổi mật khẩu; chưa gửi lại yêu cầu.'); } }
    catch (cause) { if (alive.current) setError(accountError(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="account-password">
    <p>{user.mustChangePassword ? 'Bạn cần đổi mật khẩu tạm trước khi truy cập nghiệp vụ.' : 'Đổi mật khẩu sẽ kết thúc phiên hiện tại. Bạn cần đăng nhập lại.'}</p>
    <p className="muted">Ít nhất 12 ký tự Unicode, tối đa 72 byte UTF-8. Mật khẩu không được cắt hoặc bỏ khoảng trắng.</p>
    {error && <div className="error-note" role="alert">{error}</div>}
    <form className="form-stack" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <label>Mật khẩu hiện tại<input autoFocus type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} /></label>
        <label>Mật khẩu mới<input type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} /></label>
        <label>Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        <div className="form-actions"><button className="button" type="submit">{busy ? 'Đang đổi…' : 'Đổi mật khẩu'}</button><button className="button button-quiet" type="button" onClick={() => void reloadVersion()}>Tải lại phiên bản</button></div>
      </fieldset>
    </form>
  </div>;
}

function TechnicianEditor({ editor, token, onSaved, onClose }: { editor: Editor; token: string; onSaved: () => Promise<void>; onClose: () => void }) {
  const [row, setRow] = useState('row' in editor ? editor.row : null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [work, setWork] = useState<OpenWork | null>(null);
  const [conflict, setConflict] = useState(false), [unavailable, setUnavailable] = useState(false);
  const alive = useRef(false), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const title = editor.kind === 'create' ? 'Tạo kỹ thuật viên' : editor.kind === 'reset' ? 'Reset mật khẩu' : row?.isActive ? 'Vô hiệu hóa kỹ thuật viên' : 'Kích hoạt kỹ thuật viên';
  async function submit(e: FormEvent) {
    e.preventDefault(); if (locked.current || conflict || unavailable) return;
    if (editor.kind !== 'status') { const problem = passwordProblem(password); if (problem) { setError(problem); return; } }
    locked.current = true; setBusy(true); setError(''); setWork(null);
    try {
      if (editor.kind === 'create') await createTechnician(token, email, password);
      else if (editor.kind === 'reset') await resetTechnician(token, row!, password);
      else await setTechnicianStatus(token, row!, !row!.isActive);
      if (!alive.current) return;
      setPassword('');
      // Parent closes this editor and hides its list before attempting GET.
      await onSaved();
    } catch (cause) {
      if (!alive.current) return;
      setError(accountError(cause)); setWork(openWorkOf(cause));
      setConflict(cause instanceof ApiError && cause.code === 'ACCOUNT_VERSION_CONFLICT');
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function reloadRow() {
    if (locked.current || !row) return;
    locked.current = true; setBusy(true);
    try {
      const rows = await listManagedTechnicians(token); if (!alive.current) return;
      const fresh = rows.find(item => item.id === row.id);
      if (!fresh) { setUnavailable(true); setError('Tài khoản không còn trong danh sách. Đóng form và tải lại.'); return; }
      setRow(fresh); setConflict(false); setWork(null); setError('Đã tải phiên bản mới. Kiểm tra lại trạng thái trước khi xác nhận; chưa ghi thêm.');
    } catch (cause) { if (alive.current) setError(accountError(cause)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <Dialog title={title} busy={busy} onClose={() => { setPassword(''); onClose(); }}>
    {row && <p className="account-identity">{row.email} · Phiên bản {row.version}</p>}
    {error && <div className="error-note" role="alert">{error}</div>}
    {work && <div className="account-open-work"><p>{work.taskCount} công việc · {work.issueCount} lỗi chưa hoàn tất</p><ul>
      {work.tasks.map(task => <li key={task.id}>Task {task.code} — {task.status}<small>Công trình {task.projectId}</small></li>)}
      {work.issues.map(issue => <li key={issue.id}>Issue {issue.id} — {issue.status}<small>Công trình {issue.projectId}</small></li>)}
    </ul><p>Không tự thay đổi phân công hoặc trạng thái.</p></div>}
    <form className="form-stack" onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}>
      {editor.kind === 'create' && <label>Email<input type="email" autoComplete="off" maxLength={320} required value={email} onChange={e => setEmail(e.target.value)} /></label>}
      {editor.kind !== 'status' ? <><label>Mật khẩu tạm<input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><p className="muted">12 ký tự Unicode trở lên, tối đa 72 byte UTF-8. Chuyển mật khẩu ngoài hệ thống; người dùng phải đổi trước khi làm việc. Reset không kích hoạt tài khoản đã khóa.</p></> : <p>{row?.isActive ? 'Tài khoản sẽ mất quyền đăng nhập. Không thể vô hiệu hóa khi còn Task chưa APPROVED hoặc Issue chưa CLOSED.' : 'Cho phép đăng nhập lại. Các token cũ vẫn không còn hiệu lực.'}</p>}
      {conflict && <button className="button button-quiet" type="button" onClick={() => void reloadRow()}>Tải lại phiên bản</button>}
      <div className="form-actions"><button className="button button-quiet" type="button" onClick={() => { setPassword(''); onClose(); }}>Hủy</button><button className="button" disabled={conflict || unavailable}>{busy ? 'Đang lưu…' : editor.kind === 'create' ? 'Tạo tài khoản' : 'Xác nhận'}</button></div>
    </fieldset></form>
  </Dialog>;
}

function TechnicianList({ token }: { token: string }) {
  const [rows, setRows] = useState<ManagedTechnician[] | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [editor, setEditor] = useState<Editor | null>(null);
  const gate = useRef(0);
  const alive = useRef(false);
  const refresh = useCallback(async () => {
    const ticket = ++gate.current; setLoading(true); setRows(null); setError('');
    try { const data = await listManagedTechnicians(token); if (ticket !== gate.current) return; setRows(data); }
    catch (cause) { if (ticket !== gate.current) return; setError(accountError(cause)); throw cause; }
    finally { if (ticket === gate.current) setLoading(false); }
  }, [token]);
  useEffect(() => { alive.current = true; void refresh().catch(() => {}); return () => { alive.current = false; gate.current++; }; }, [refresh]);
  async function saved() {
    setEditor(null); setRows(null); setNotice('Đã lưu tài khoản trên server.');
    try { await refresh(); } catch { if (alive.current) setNotice(REFRESH_FAILED); }
  }
  return <>
    <div className="account-list-heading"><p>Quản lý kỹ thuật viên; không xóa tài khoản hoặc đổi vai trò.</p><button className="button" disabled={loading || !rows} onClick={() => { setNotice(''); setEditor({ kind: 'create' }); }}>Tạo kỹ thuật viên</button></div>
    {notice && <p role="status" className="account-notice">{notice}</p>}
    {error && <div className="error-note" role="alert">{error} <button className="button button-quiet button-small" disabled={loading} onClick={() => void refresh().catch(() => {})}>Tải lại danh sách</button></div>}
    {loading && <p role="status">Đang tải tài khoản…</p>}
    {rows && !rows.length && <p>Chưa có kỹ thuật viên. Tạo tài khoản bằng email và mật khẩu tạm.</p>}
    {rows && rows.length > 0 && <ListView rows={rows} text={r => r.email} kind={r => r.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'} label="kỹ thuật viên" className="account-list">{row => <li key={row.id}>
      <div><h2>{row.email}</h2><span className="role-chip">{row.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}</span><p>{row.mustChangePassword ? 'Cần đổi mật khẩu tạm' : 'Mật khẩu đã thiết lập'} · Phiên bản {row.version}</p></div>
      <div className="account-row-actions"><button className="button button-quiet button-small" onClick={() => setEditor({ kind: 'reset', row })}>Reset mật khẩu</button><button className="button button-quiet button-small" onClick={() => setEditor({ kind: 'status', row })}>{row.isActive ? 'Vô hiệu hóa' : 'Kích hoạt'}</button></div>
    </li>}</ListView>}
    {editor && <TechnicianEditor token={token} editor={editor} onClose={() => setEditor(null)} onSaved={saved} />}
  </>;
}

export default function AccountWorkspace({ token, user, mode, onBack, onSignOut, onPasswordChanged }: Props) {
  const forced = user.mustChangePassword;
  return <div className="workspace-shell"><header className="topbar account-topbar"><span className="brand brand-copy">Hạ tầng điện nhẹ<small>Tài khoản & bảo mật</small></span><div className="account-actions"><span className="account-identity">{user.email}</span><button className="button button-quiet signout" onClick={onSignOut}>Đăng xuất</button></div></header>
    <main className="account-workspace"><div className="function-heading"><h1>{forced || mode === 'password' ? 'Đổi mật khẩu' : 'Quản lý tài khoản'}</h1>{!forced && <button className="button button-quiet" onClick={onBack}>Về công trình</button>}</div>
      {forced || mode === 'password' ? <PasswordForm key={user.id} token={token} user={user} onChanged={onPasswordChanged} /> : user.role === 'MANAGER' ? <TechnicianList token={token} /> : <p role="alert">Bạn không có quyền quản lý tài khoản.</p>}
    </main></div>;
}
