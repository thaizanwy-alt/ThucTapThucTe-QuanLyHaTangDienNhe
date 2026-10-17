export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) { super(message); }
}

export type SessionId = number;
type SessionFailure = { token: string; sessionId: SessionId; kind: 'expired' | 'password-required' };
const sessionListeners = new Set<(event: SessionFailure) => void>();
let nextSessionId = 0;
let activeSession: { id: SessionId; token: string } | null = null;

/** Each successful login/restore gets a new identity even when the JWT string is unchanged. */
export function startSession(token: string): SessionId {
  const id = ++nextSessionId;
  activeSession = { id, token };
  return id;
}

export function sessionIdFor(token: string): SessionId | null {
  return activeSession?.token === token ? activeSession.id : null;
}

export function isCurrentSession(id: SessionId, token?: string): boolean {
  return activeSession?.id === id && (token === undefined || activeSession.token === token);
}

/** Invalidate before local/session cleanup; a stale caller cannot invalidate a newer login. */
export function invalidateSession(id: SessionId): boolean {
  if (!isCurrentSession(id)) return false;
  activeSession = null;
  return true;
}

export function onSessionFailure(listener: (event: SessionFailure) => void) {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

export function reportSessionFailure(token: string, sessionId: SessionId | null, kind: SessionFailure['kind'] = 'expired') {
  if (sessionId === null) return;
  for (const listener of sessionListeners) listener({ token, sessionId, kind });
}

export const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

const messages: Record<number, string> = {
  400: 'Thông tin chưa hợp lệ. Hãy kiểm tra các trường đã nhập.',
  401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Tài khoản hiện tại không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy dữ liệu. Danh sách có thể đã được cập nhật.',
  409: 'Mã đã được sử dụng hoặc dữ liệu vẫn còn mục phụ thuộc.',
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers: suppliedHeaders, ...requestOptions } = options;
  // Capture identity at dispatch, not when a late response is handled.
  const requestSessionId = token ? sessionIdFor(token) : null;
  const headers = new Headers(suppliedHeaders);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (requestOptions.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...requestOptions,
      headers,
      signal: requestOptions.signal ? AbortSignal.any([requestOptions.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra backend rồi thử lại.');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code : undefined;
    if (token && (response.status === 401 || code === 'PASSWORD_CHANGE_REQUIRED')) {
      reportSessionFailure(token, requestSessionId, response.status === 401 ? 'expired' : 'password-required');
    }
    throw new ApiError(response.status, code === 'PASSWORD_CHANGE_REQUIRED'
      ? 'Bạn cần đổi mật khẩu tạm trước khi tiếp tục.'
      : messages[response.status] ?? 'Máy chủ đang gặp sự cố. Vui lòng thử lại.', code, body?.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
