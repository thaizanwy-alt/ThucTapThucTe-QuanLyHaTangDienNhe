import { apiRequest, ApiError } from './client';

export interface User {
  id: string;
  email: string;
  role: 'MANAGER' | 'TECHNICIAN';
  isActive: boolean;
}

export async function login(email: string, password: string): Promise<string> {
  let result: { accessToken: string };
  try {
    result = await apiRequest<{ accessToken: string }>('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      throw new ApiError(401, 'Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.');
    }
    throw cause;
  }
  if (typeof result.accessToken !== 'string' || !result.accessToken) {
    throw new Error('Phản hồi đăng nhập không hợp lệ. Vui lòng thử lại.');
  }
  return result.accessToken;
}

export async function getMe(token: string): Promise<User> {
  const user = await apiRequest<User>('/auth/me', { token });
  if (typeof user.id !== 'string' || typeof user.email !== 'string' ||
      !['MANAGER', 'TECHNICIAN'].includes(user.role) || user.isActive !== true) {
    throw new Error('Thông tin tài khoản không hợp lệ. Vui lòng đăng nhập lại.');
  }
  return { id: user.id, email: user.email, role: user.role, isActive: user.isActive };
}

export { ApiError };
