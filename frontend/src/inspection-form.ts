import type { User } from './api/auth';
import type { ProjectDevice } from './api/devices';
import type { ProjectSystem } from './api/projects';
import type { Technician } from './api/tasks';
import type { ChecklistTemplate, InspectionInput, InspectionResult, ItemDetail, Issue, RecheckInput, ResultInput } from './api/inspections';

export const resultLabels = { NOT_CHECKED: 'Chưa kiểm tra', PASS: 'Đạt', FAIL: 'Không đạt' };
export const issueLabels = { OPEN: 'Chờ khắc phục', IN_PROGRESS: 'Đang sửa', RESOLVED: 'Chờ kiểm tra lại', CLOSED: 'Đã đóng' };
export const SAVED_REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.';
const required = (value: string, label: string) => { if (!value.trim()) throw new Error(`${label} không được để trống.`); return value.trim(); };
const version = (n: number) => { if (!Number.isInteger(n) || n < 1 || n >= 2147483647) throw new Error('Phiên bản không hợp lệ; hãy tải lại.'); return n; };
export interface InspectionDraft { code: string; title: string; systemId: string; templateId: string; scope: 'none' | 'area' | 'device'; scopeId: string }
export function inspectionPayload(d: InspectionDraft, systems: ProjectSystem[], templates: ChecklistTemplate[], devices: ProjectDevice[], areaIds: string[]): InspectionInput {
  const system = systems.find(s => s.id === d.systemId);
  const template = templates.find(t => t.id === d.templateId && t.isActive && t.category === system?.category);
  if (!system || !template) throw new Error('Chọn System và mẫu cùng loại hệ thống.');
  const code = required(d.code, 'Mã phiếu').toUpperCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) throw new Error('Mã chỉ gồm chữ, số và dấu gạch ngang.');
  if (d.scope === 'area' && !areaIds.includes(d.scopeId)) throw new Error('Chọn khu vực trong công trình.');
  if (d.scope === 'device' && !devices.some(device => device.id === d.scopeId && device.systemIds.includes(system.id))) throw new Error('Thiết bị phải thuộc System đã chọn.');
  return { code, title: required(d.title, 'Tên phiếu'), systemId: system.id, templateId: template.id,
    areaId: d.scope === 'area' ? d.scopeId : null, deviceId: d.scope === 'device' ? d.scopeId : null };
}
export function resultPayload(item: ItemDetail, result: InspectionResult, note: string, description: string, assigneeId: string, technicians: Technician[]): ResultInput {
  if (!(result in resultLabels)) throw new Error('Kết quả không hợp lệ.');
  if (item.activeIssue && result !== 'FAIL') throw new Error('Kiểm tra lại lỗi đang mở trước khi đổi kết quả.');
  const input: ResultInput = { expectedVersion: version(item.version), result, note: note.trim() || null };
  if (result === 'FAIL' && !item.activeIssue) {
    if (!technicians.some(t => t.id === assigneeId)) throw new Error('Chọn kỹ thuật viên active.');
    input.issue = { description: required(description, 'Mô tả lỗi'), assigneeId };
  }
  return input;
}
export function recheckPayload(issue: Issue, itemVersion: number, result: 'PASS' | 'FAIL', note: string, reason: string): RecheckInput {
  if (issue.status !== 'RESOLVED') throw new Error('Chỉ kiểm tra lại lỗi đã báo sửa.');
  if (result !== 'PASS' && result !== 'FAIL') throw new Error('Kết quả không hợp lệ.');
  return { expectedVersion: version(issue.version), expectedItemVersion: version(itemVersion), result,
    note: required(note, 'Ghi chú kiểm tra lại'), ...(result === 'FAIL' ? { reason: required(reason, 'Lý do trả lỗi') } : {}) };
}
export function issueActions(user: User, issue: Issue) {
  return { assign: user.role === 'MANAGER' && issue.status === 'OPEN', recheck: user.role === 'MANAGER' && issue.status === 'RESOLVED',
    start: user.role === 'TECHNICIAN' && user.id === issue.assigneeId && issue.status === 'OPEN',
    resolve: user.role === 'TECHNICIAN' && user.id === issue.assigneeId && issue.status === 'IN_PROGRESS' };
}
export class InspectionRequestGate {
  private generation = 0;
  begin() { return ++this.generation; }
  current(id: number) { return id === this.generation; }
  invalidate() { this.generation++; }
}
export async function saveInspectionAndRefresh(write: () => Promise<unknown>, closeAndHide: () => void, refresh: () => Promise<boolean>) {
  await write(); // Failure keeps the form and entered text intact.
  closeAndHide();
  return await refresh(); // Retry is a separate GET; never call write again here.
}
