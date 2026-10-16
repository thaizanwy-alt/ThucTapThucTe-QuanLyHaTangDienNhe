import { ApiError, baseUrl } from './client';

export type ExportKind = 'acceptance' | 'devices' | 'connections';
export type ExportFile = { blob: Blob; name: string };

const errors: Record<number, string> = {
  400: 'Yêu cầu xuất chưa hợp lệ.',
  401: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Bạn không có quyền xuất hồ sơ này.',
  404: 'Không tìm thấy công trình hoặc hồ sơ được chọn.',
  409: 'Hồ sơ chưa xác nhận hoặc snapshot không thể xuất. Hãy tải lại hồ sơ.',
  413: 'File xuất vượt giới hạn dung lượng, số dòng hoặc số trang.',
  503: 'Máy chủ chưa thể tạo file xuất. Hãy thử lại sau.',
};

export function exportPath(projectId: string, kind: ExportKind, acceptanceId?: string): string {
  const project = `/projects/${encodeURIComponent(projectId)}`;
  if (kind === 'acceptance') {
    if (!acceptanceId) throw new Error('Chưa chọn hồ sơ nghiệm thu.');
    return `${project}/acceptances/${encodeURIComponent(acceptanceId)}/export.pdf`;
  }
  return `${project}/exports/${kind === 'devices' ? 'devices' : 'connections'}.xlsx`;
}

export function exportFilename(header: string | null, fallback: string, extension: 'pdf' | 'xlsx'): string {
  const encoded = header?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = header?.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let proposed = plain?.[1] ?? plain?.[2]?.trim() ?? '';
  if (encoded) {
    try { proposed = decodeURIComponent(encoded.trim().replace(/^"|"$/g, '')); } catch { /* use plain/fallback */ }
  }
  // Never trust a server-provided path or control characters as a download name.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(proposed) || proposed.includes('..') ||
      !proposed.toLowerCase().endsWith(`.${extension}`)) return fallback;
  return proposed;
}

export async function requestExport(token: string, projectId: string, kind: ExportKind,
  signal: AbortSignal, acceptanceId?: string): Promise<ExportFile> {
  const path = exportPath(projectId, kind, acceptanceId);
  let response: Response;
  try {
    response = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${token}` }, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(0, 'Không kết nối được máy chủ để xuất file. Hãy thử lại.');
  }
  if (!response.ok) {
    // Error responses are JSON even though success responses are binary.
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'message' in body ? (body as { message: unknown }).message : null;
    const detail = typeof message === 'string' ? message : Array.isArray(message) ? message.filter(x => typeof x === 'string').join('; ') : '';
    throw new ApiError(response.status, `${errors[response.status] ?? 'Không tải được file xuất.'}${detail ? ` ${detail}` : ''}`);
  }
  const extension = kind === 'acceptance' ? 'pdf' : 'xlsx';
  const fallback = kind === 'acceptance' ? 'ho-so-nghiem-thu.pdf' : kind === 'devices' ? 'danh-muc-thiet-bi.xlsx' : 'dau-noi.xlsx';
  try {
    return { blob: await response.blob(), name: exportFilename(response.headers.get('content-disposition'), fallback, extension) };
  } catch {
    throw new ApiError(0, 'Không đọc được file xuất. Hãy thử lại.');
  }
}
