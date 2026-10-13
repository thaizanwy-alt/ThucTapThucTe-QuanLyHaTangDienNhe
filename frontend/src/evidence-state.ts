import type { User } from './api/auth';
import type { EvidenceTarget } from './api/evidence';
export function evidencePermissions(user: User, target: EvidenceTarget) {
  const read = target.kind === 'item' ? user.role === 'MANAGER' : user.role === 'MANAGER' || target.assigneeId === user.id;
  const unlocked = target.kind === 'item' ? target.status !== 'PASS' : (target.kind === 'task' ? ['ASSIGNED', 'IN_PROGRESS', 'RETURNED'] : ['OPEN', 'IN_PROGRESS']).includes(target.status);
  return { read, write: read && unlocked };
}
export function validateEvidenceFile(file: { size: number; type: string; name: string }, caption: string) {
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error('Chọn file không rỗng, tối đa 10 MiB.');
  const extensions: Record<string, RegExp> = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'application/pdf': /\.pdf$/i };
  if (!extensions[file.type]?.test(file.name)) throw new Error('Chỉ nhận JPEG/PNG/PDF. Server kiểm tra lại nội dung thực tế.');
  if (caption.trim().length > 1000) throw new Error('Chú thích tối đa 1000 ký tự.');
}
// Session-only retry ledger survives closing a dialog; never stores tokens/files.
const attempts = new Map<string, { fingerprint: string; key: string }>();
export function uploadKey(scope: string, fingerprint: string, fresh = false) {
  const old = attempts.get(scope);
  if (!fresh && old?.fingerprint === fingerprint) return old.key;
  const key = crypto.randomUUID(); attempts.set(scope, { fingerprint, key }); return key;
}
export function clearUploadKey(scope: string) { attempts.delete(scope); }
export async function uploadFingerprint(file: File, caption: string) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return JSON.stringify([file.name, file.type, file.size, Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join(''), caption.trim() || null]);
}
export class EvidenceGate {
  private revision = 0;
  begin() { return ++this.revision; }
  current(id: number) { return this.revision === id; }
  invalidate() { ++this.revision; }
}
export class EvidenceUrls {
  private urls = new Set<string>();
  create(blob: Blob) { const url = URL.createObjectURL(blob); this.urls.add(url); return url; }
  release(url: string) { if (this.urls.delete(url)) URL.revokeObjectURL(url); }
  clear() { for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear(); }
}
