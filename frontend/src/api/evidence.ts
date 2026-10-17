import { ApiError, baseUrl, reportSessionFailure, sessionIdFor } from './client';
export interface Evidence {
  id: string; projectId: string; taskId: string | null; inspectionItemId: string | null; issueId: string | null;
  originalName: string; mimeType: string; sizeBytes: number; sha256: string;
  uploadedBy: { id: string; email: string } | null; createdAt: string; caption: string | null; version: number;
}
export type EvidenceTarget = { kind: 'task' | 'issue'; id: string; status: string; assigneeId: string }
  | { kind: 'item'; id: string; inspectionId: string; status: string };
export function evidencePath(projectId: string, target: EvidenceTarget) {
  const p = `/projects/${encodeURIComponent(projectId)}`;
  return `${p}/${target.kind === 'item' ? `inspections/${encodeURIComponent(target.inspectionId)}/items` : target.kind === 'task' ? 'tasks' : 'issues'}/${encodeURIComponent(target.id)}/evidence`;
}
const errors: Record<number, string> = {
  400: 'Thông tin minh chứng chưa hợp lệ.', 401: 'Phiên đăng nhập hết hạn.',
  403: 'Bạn không có quyền thao tác minh chứng này.', 404: 'Minh chứng không còn tồn tại hoặc không thuộc phạm vi được giao.',
  409: 'Phiên bản, quyền, trạng thái hoặc hạn mức đã thay đổi. Tải lại hồ sơ trước khi thử tiếp.',
  413: 'File vượt giới hạn 10 MiB.', 415: 'Chỉ nhận JPEG/PNG/PDF khớp định dạng thực tế.',
  503: 'Kho minh chứng chưa sẵn sàng. Giữ nguyên file và chú thích khi thử lại.',
};
export async function evidenceRequest<T>(token: string, path: string, options: RequestInit = {}, blob = false): Promise<T> {
  const requestSessionId = sessionIdFor(token);
  const headers = new Headers(options.headers); headers.set('Authorization', `Bearer ${token}`);
  if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(baseUrl + path, { ...options, headers, signal: AbortSignal.timeout(30000) }); }
  catch { throw new ApiError(0, 'Chưa nhận được kết quả từ server. Retry cùng file/chú thích sẽ dùng lại key, không tạo trùng.'); }
  if (!response.ok) {
    if (response.status === 401) reportSessionFailure(token, requestSessionId);
    throw new ApiError(response.status, errors[response.status] ?? 'Chưa xác nhận được kết quả. Giữ nguyên nội dung khi thử lại.');
  }
  if (response.status === 204) return undefined as T;
  try { return await (blob ? response.blob() : response.json()) as T; }
  catch { throw new ApiError(0, 'Không đọc được phản hồi. Giữ nguyên nội dung khi thử lại.'); }
}
export const listEvidence = (token: string, p: string, t: EvidenceTarget) => evidenceRequest<Evidence[]>(token, evidencePath(p, t));
export function uploadEvidence(token: string, p: string, t: EvidenceTarget, file: File, caption: string, key: string) {
  const body = new FormData(); body.append('file', file); body.append('caption', caption.trim());
  return evidenceRequest<Evidence>(token, evidencePath(p, t), { method: 'POST', headers: { 'Idempotency-Key': key }, body });
}
const recordPath = (p: string, id: string) => `/projects/${encodeURIComponent(p)}/evidence/${encodeURIComponent(id)}`;
export const updateEvidence = (token: string, p: string, row: Evidence, caption: string | null) => evidenceRequest<Evidence>(token, recordPath(p, row.id), { method: 'PATCH', body: JSON.stringify({ expectedVersion: row.version, caption }) });
export const deleteEvidence = (token: string, p: string, row: Evidence, reason: string) => evidenceRequest<void>(token, recordPath(p, row.id), { method: 'DELETE', body: JSON.stringify({ expectedVersion: row.version, reason: reason.trim() }) });
export const evidenceBlob = (token: string, p: string, id: string, preview: boolean) => evidenceRequest<Blob>(token, recordPath(p, id) + (preview ? '/preview' : '/content'), {}, true);
