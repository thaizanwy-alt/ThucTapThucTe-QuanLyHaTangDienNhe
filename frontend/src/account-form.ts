import { ApiError } from './api/client';
import type { OpenWork } from './api/users';
export function passwordProblem(password: string): string {
  return [...password].length < 12 || new TextEncoder().encode(password).length > 72 || password.includes('\0')
    ? 'Mật khẩu cần ít nhất 12 ký tự Unicode, tối đa 72 byte UTF-8 và không chứa NUL.' : '';
}
export function accountError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Không thực hiện được thao tác. Vui lòng thử lại.';
  switch (error.code) {
    case 'TECHNICIAN_HAS_OPEN_WORK': return 'Chưa thể vô hiệu hóa: kỹ thuật viên còn công việc hoặc lỗi chưa hoàn tất. Hãy xử lý hoặc giao lại trong màn hình nghiệp vụ.';
    case 'EMAIL_ALREADY_EXISTS': return 'Email đã được sử dụng.';
    case 'ACCOUNT_VERSION_CONFLICT': return 'Tài khoản đã thay đổi. Tải lại phiên bản, kiểm tra rồi xác nhận lại; nội dung nhập được giữ.';
    case 'PASSWORD_UNCHANGED': return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    case 'INVALID_PASSWORD': return 'Mật khẩu cần ít nhất 12 ký tự Unicode, tối đa 72 byte UTF-8 và không chứa NUL.';
    default: return error.message;
  }
}
export function openWorkOf(error: unknown): OpenWork | null {
  if (!(error instanceof ApiError) || error.code !== 'TECHNICIAN_HAS_OPEN_WORK') return null;
  const d = error.details as OpenWork | undefined;
  return d && Number.isInteger(d.taskCount) && Number.isInteger(d.issueCount) && Array.isArray(d.tasks) && Array.isArray(d.issues) ? d : null;
}
