import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, getMe, login } from './api/auth';
import type { User } from './api/auth';
import ProjectWorkspace from './ProjectWorkspace';

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
  const version = useRef(0);

  const signOut = useCallback((message = '') => {
    version.current++;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* Storage may be disabled. */ }
    setToken(null); setUser(null); setPassword('');
    setChecking(false); setPending(false); setError(message);
  }, []);
  const handleSignOut = useCallback(() => signOut(), [signOut]);

  const restore = useCallback(async () => {
    const current = ++version.current;
    let saved: string | null;
    try { saved = localStorage.getItem(TOKEN_KEY); }
    catch { signOut('Trình duyệt không cho lưu phiên. Vui lòng cho phép bộ nhớ trang web.'); return; }
    if (!saved) { setToken(null); setUser(null); setChecking(false); return; }
    if (expiry(saved) <= Date.now()) { signOut(EXPIRED); return; }
    setChecking(true); setError('');
    try {
      const account = await getMe(saved);
      if (current !== version.current) return;
      if (expiry(saved) <= Date.now()) { signOut(EXPIRED); return; }
      setToken(saved); setUser(account);
    } catch (cause) {
      if (current !== version.current) return;
      if (cause instanceof ApiError && cause.status === 401) { signOut(EXPIRED); return; }
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
    const timeout = window.setTimeout(() => signOut(EXPIRED), Math.max(0, expiry(token) - Date.now()));
    const verify = async () => {
      const current = version.current;
      if (expiry(token) <= Date.now()) { signOut(EXPIRED); return; }
      try {
        const account = await getMe(token);
        if (current === version.current) setUser(account);
      } catch (cause) {
        if (current === version.current && cause instanceof ApiError && cause.status === 401) signOut(EXPIRED);
      }
    };
    window.addEventListener('focus', verify);
    return () => { clearTimeout(timeout); window.removeEventListener('focus', verify); };
  }, [token, signOut]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const current = ++version.current;
    setPending(true); setError('');
    try {
      const accessToken = await login(email, password);
      const account = await getMe(accessToken);
      if (current !== version.current) return;
      if (expiry(accessToken) <= Date.now()) { signOut(EXPIRED); return; }
      try { localStorage.setItem(TOKEN_KEY, accessToken); }
      catch { throw new Error('Không lưu được phiên. Vui lòng cho phép bộ nhớ trang web rồi thử lại.'); }
      setToken(accessToken); setUser(account); setPassword('');
    } catch (cause) {
      if (current !== version.current) return;
      if (cause instanceof ApiError && cause.status === 401) { signOut(cause.message); return; }
      setError(cause instanceof Error ? cause.message : 'Đăng nhập thất bại. Vui lòng thử lại.');
    } finally { if (current === version.current) setPending(false); }
  }

  if (user && token) return <ProjectWorkspace token={token} user={user} onSignOut={handleSignOut} />;

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
