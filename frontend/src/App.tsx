import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, getMe, login } from './api/auth';
import type { User } from './api/auth';
import ProjectWorkspace from './ProjectWorkspace';
import AccountWorkspace from './AccountWorkspace';
import { invalidateSession, isCurrentSession, onSessionFailure, startSession } from './api/client';
import type { SessionId } from './api/client';

const TOKEN_KEY = 'elv-demo-access-token';
const EXPIRED = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';

function expiry(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(atob(payload)).exp;
    return typeof value === 'number' ? value * 1000 : 0;
  } catch { return 0; }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [screen, setScreen] = useState<'projects' | 'manage' | 'password'>('projects');
  const version = useRef(0);
  const sessionIdRef = useRef<SessionId | null>(null);
  const [sessionId, setSessionId] = useState<SessionId | null>(null);

  const signOut = useCallback((message = '', expectedSessionId?: SessionId) => {
    if (expectedSessionId !== undefined && sessionIdRef.current !== expectedSessionId) return;
    const oldSessionId = sessionIdRef.current;
    if (oldSessionId !== null) invalidateSession(oldSessionId);
    sessionIdRef.current = null;
    setSessionId(null);
    version.current++;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* Storage may be disabled. */ }
    setToken(null); setUser(null); setPassword('');
    setScreen('projects');
    setChecking(false); setPending(false); setError(message);
  }, []);
  // Callback passed to a workspace is bound to the session that rendered it.
  // A request retained by an unmounted workspace cannot sign out a later session.
  const handleSignOut = useCallback(() => {
    if (sessionId !== null) signOut('', sessionId);
  }, [sessionId, signOut]);

  useEffect(() => onSessionFailure(event => {
    if (event.sessionId !== sessionIdRef.current || !isCurrentSession(event.sessionId, event.token)) return;
    if (event.kind === 'expired') signOut(EXPIRED, event.sessionId);
    else { version.current++; setUser(current => current ? { ...current, mustChangePassword: true } : null); setScreen('password'); }
  }), [signOut]);

  const restore = useCallback(async () => {
    const current = ++version.current;
    let saved: string | null;
    try { saved = localStorage.getItem(TOKEN_KEY); }
    catch { signOut('Trình duyệt không cho lưu phiên. Vui lòng cho phép bộ nhớ trang web.'); return; }
    if (!saved) {
      const oldSessionId = sessionIdRef.current;
      if (oldSessionId !== null) invalidateSession(oldSessionId);
      sessionIdRef.current = null; setSessionId(null);
      setToken(null); setUser(null); setChecking(false); return;
    }
    if (expiry(saved) <= Date.now()) { signOut(EXPIRED); return; }
    const restoredSessionId = startSession(saved);
    sessionIdRef.current = restoredSessionId;
    setSessionId(restoredSessionId);
    setChecking(true); setError('');
    try {
      const account = await getMe(saved);
      if (current !== version.current || !isCurrentSession(restoredSessionId, saved)) return;
      if (expiry(saved) <= Date.now()) { signOut(EXPIRED, restoredSessionId); return; }
      setToken(saved); setUser(account);
    } catch (cause) {
      if (current !== version.current || !isCurrentSession(restoredSessionId, saved)) return;
      if (cause instanceof ApiError && cause.status === 401) { signOut(EXPIRED, restoredSessionId); return; }
      invalidateSession(restoredSessionId); sessionIdRef.current = null; setSessionId(null);
      setUser(null); setToken(null);
      setError(cause instanceof Error ? cause.message : 'Không kiểm tra được phiên đăng nhập.');
    } finally { if (current === version.current) setChecking(false); }
  }, [signOut]);

  useEffect(() => {
    void restore();
    const changed = (event: StorageEvent) => { if (event.key === TOKEN_KEY || event.key === null) void restore(); };
    window.addEventListener('storage', changed);
    return () => { version.current++; window.removeEventListener('storage', changed); };
  }, [restore]);

  useEffect(() => {
    if (!token) return;
    const activeSessionId = sessionId;
    if (activeSessionId === null || !isCurrentSession(activeSessionId, token)) return;
    const timeout = window.setTimeout(() => signOut(EXPIRED, activeSessionId), Math.max(0, expiry(token) - Date.now()));
    const verify = async () => {
      const current = version.current;
      if (expiry(token) <= Date.now()) { signOut(EXPIRED, activeSessionId); return; }
      try {
        const account = await getMe(token);
        if (current === version.current && isCurrentSession(activeSessionId, token)) setUser(account);
      } catch (cause) {
        if (current === version.current && isCurrentSession(activeSessionId, token) && cause instanceof ApiError && cause.status === 401) signOut(EXPIRED, activeSessionId);
      }
    };
    window.addEventListener('focus', verify);
    return () => { clearTimeout(timeout); window.removeEventListener('focus', verify); };
  }, [token, sessionId, signOut]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const current = ++version.current;
    setPending(true); setError('');
    let loginSessionId: SessionId | null = null;
    try {
      const accessToken = await login(email, password);
      if (current !== version.current) return;
      loginSessionId = startSession(accessToken);
      sessionIdRef.current = loginSessionId;
      setSessionId(loginSessionId);
      const account = await getMe(accessToken);
      if (current !== version.current || !isCurrentSession(loginSessionId, accessToken)) return;
      if (expiry(accessToken) <= Date.now()) { signOut(EXPIRED, loginSessionId); return; }
      try { localStorage.setItem(TOKEN_KEY, accessToken); }
      catch { throw new Error('Không lưu được phiên. Vui lòng cho phép bộ nhớ trang web rồi thử lại.'); }
      setToken(accessToken); setUser(account); setPassword('');
    } catch (cause) {
      if (current !== version.current) return;
      if (cause instanceof ApiError && cause.status === 401) { signOut(cause.message, loginSessionId ?? undefined); return; }
      if (loginSessionId !== null && isCurrentSession(loginSessionId)) {
        invalidateSession(loginSessionId); sessionIdRef.current = null; setSessionId(null);
      }
      setError(cause instanceof Error ? cause.message : 'Đăng nhập thất bại. Vui lòng thử lại.');
    } finally { if (current === version.current) setPending(false); }
  }

  if (user && token) {
    if (user.mustChangePassword || screen !== 'projects') return <AccountWorkspace key={`${user.id}:${sessionId}:${screen}`} token={token} user={user} mode={screen === 'manage' ? 'manage' : 'password'} onBack={() => setScreen('projects')} onSignOut={handleSignOut} onPasswordChanged={() => signOut('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.', sessionId ?? undefined)} />;
    return <ProjectWorkspace token={token} user={user} onSignOut={handleSignOut} onManageAccounts={() => setScreen('manage')} onChangePassword={() => setScreen('password')} />;
  }

  return (
    <div className="app-shell">
      <header className="brand"><span className="brand-mark" aria-hidden="true">E</span><span>HẠ TẦNG ĐIỆN NHẸ<small>Quản lý thi công</small></span></header>
      <main className="card">
        {checking ? <div className="loading" role="status">Đang kiểm tra phiên đăng nhập…</div> : user ? (
          <>
            <span className="eyebrow">TỔNG QUAN</span>
            <h1>Chào mừng trở lại</h1>
            <p className="intro">Bạn đã đăng nhập thành công.</p>
            <dl className="account"><div><dt>Tài khoản</dt><dd>{user.email}</dd></div><div><dt>Vai trò</dt><dd><span className="badge">{user.role === 'MANAGER' ? 'Quản lý' : 'Kỹ thuật viên'}</span><span className="role-code">{user.role}</span></dd></div></dl>
            <button className="button" onClick={() => signOut()}>Đăng xuất</button>
          </>
        ) : (
          <>
            <span className="eyebrow">CHÀO MỪNG BẠN</span>
            <h1>Đăng nhập</h1>
            <p className="intro">Sử dụng tài khoản được cấp để truy cập hệ thống.</p>
            {error && <div className="error" role="alert">{error}</div>}
            <form onSubmit={submit} aria-busy={pending}>
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" maxLength={320} required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} />
              <label htmlFor="password">Mật khẩu</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending} />
              <button className="button" type="submit" disabled={pending}>{pending ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
            </form>
          </>
        )}
      </main>
      <footer>Bản demo thực tập · Phiên đăng nhập lưu trên trình duyệt này</footer>
    </div>
  );
}
