export interface User {
  id: string;
  email: string;
  role: 'MANAGER' | 'TECHNICIAN';
  isActive: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function request(path: string, options: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Vui lòng kiểm tra kết nối và thử lại.');
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.status === 401
      ? 'Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.'
      : response.status === 400 ? 'Vui lòng kiểm tra email và mật khẩu đã nhập.'
      : 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.');
  }
  return response.json();
}

export async function login(email: string, password: string): Promise<string> {
  const result = await request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (typeof result.accessToken !== 'string' || !result.accessToken) {
    throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng thử lại.');
  }
  return result.accessToken;
}

export async function getMe(token: string): Promise<User> {
  const user = await request('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  if (typeof user.id !== 'string' || typeof user.email !== 'string' ||
      !['MANAGER', 'TECHNICIAN'].includes(user.role) || user.isActive !== true) {
    throw new Error('Thông tin tài khoản không hợp lệ. Vui lòng đăng nhập lại.');
  }
  return { id: user.id, email: user.email, role: user.role, isActive: user.isActive };
}
