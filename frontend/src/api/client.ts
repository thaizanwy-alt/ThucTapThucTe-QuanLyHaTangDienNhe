export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
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
  const headers = new Headers(suppliedHeaders);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (requestOptions.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...requestOptions,
      headers,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra backend rồi thử lại.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, messages[response.status] ?? 'Máy chủ đang gặp sự cố. Vui lòng thử lại.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
