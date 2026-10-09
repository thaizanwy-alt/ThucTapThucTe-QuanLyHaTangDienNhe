import { apiRequest } from './client';
import type { SystemCategory } from './projects';

export type InspectionResult = 'NOT_CHECKED' | 'PASS' | 'FAIL';
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export interface TemplateItem { id: string; code: string; title: string; instruction: string | null; sortOrder: number }
export interface ChecklistTemplate { id: string; code: string; name: string; category: SystemCategory; revision: number; isActive: boolean; items: TemplateItem[] }
export interface Issue {
  id: string; projectId: string; itemId: string; description: string; assigneeId: string; status: IssueStatus;
  resolutionNote: string | null; resolvedAt: string | null; returnReason: string | null;
  reviewedById: string | null; reviewedAt: string | null; version: number; createdAt: string; updatedAt: string;
}
export interface InspectionItem extends TemplateItem {
  projectId: string; inspectionId: string; result: InspectionResult; note: string | null;
  checkedById: string | null; checkedAt: string | null; version: number;
}
export interface ItemDetail extends InspectionItem { activeIssue: Issue | null; issues: Issue[] }
export interface Inspection {
  id: string; projectId: string; code: string; title: string; systemId: string; areaId: string | null; deviceId: string | null;
  templateId: string; templateRevision: number; createdById: string; createdAt: string; updatedAt: string;
  items: ItemDetail[]; summary: { total: number; notChecked: number; pass: number; fail: number; openIssues: number }; passed: boolean;
}
export interface IssueDetail extends Issue {
  assignee: { id: string; email: string } | null; item: InspectionItem;
  inspectionId: string; inspectionCode: string; systemId: string; areaId: string | null; deviceId: string | null;
}
export interface InspectionInput { code: string; title: string; systemId: string; templateId: string; areaId: string | null; deviceId: string | null }
export interface ResultInput { expectedVersion: number; result: InspectionResult; note: string | null; issue?: { description: string; assigneeId: string } }
export interface RecheckInput { expectedVersion: number; expectedItemVersion: number; result: 'PASS' | 'FAIL'; note: string; reason?: string }
const base = (p: string) => `/projects/${encodeURIComponent(p)}`;
const sheet = (p: string, id?: string) => `${base(p)}/inspections${id ? `/${encodeURIComponent(id)}` : ''}`;
const issue = (p: string, id?: string) => `${base(p)}/issues${id ? `/${encodeURIComponent(id)}` : ''}`;
export const listTemplates = (token: string) => apiRequest<ChecklistTemplate[]>('/checklist-templates', { token });
export const listInspections = (token: string, p: string) => apiRequest<Inspection[]>(sheet(p), { token });
export const getInspection = (token: string, p: string, id: string) => apiRequest<Inspection>(sheet(p, id), { token });
export const createInspection = (token: string, p: string, input: InspectionInput) => apiRequest<Inspection>(sheet(p), { token, method: 'POST', body: JSON.stringify(input) });
export const putResult = (token: string, p: string, sheetId: string, itemId: string, input: ResultInput) => apiRequest<ItemDetail>(`${sheet(p, sheetId)}/items/${encodeURIComponent(itemId)}/result`, { token, method: 'PUT', body: JSON.stringify(input) });
export const listIssues = (token: string, p: string) => apiRequest<IssueDetail[]>(issue(p), { token });
export const getIssue = (token: string, p: string, id: string) => apiRequest<IssueDetail>(issue(p, id), { token });
export const assignIssue = (token: string, p: string, id: string, expectedVersion: number, assigneeId: string) => apiRequest<IssueDetail>(`${issue(p, id)}/assignee`, { token, method: 'PATCH', body: JSON.stringify({ expectedVersion, assigneeId }) });
export const startIssue = (token: string, p: string, id: string, expectedVersion: number) => apiRequest<IssueDetail>(`${issue(p, id)}/start`, { token, method: 'POST', body: JSON.stringify({ expectedVersion }) });
export const resolveIssue = (token: string, p: string, id: string, expectedVersion: number, resolutionNote: string) => apiRequest<IssueDetail>(`${issue(p, id)}/resolve`, { token, method: 'POST', body: JSON.stringify({ expectedVersion, resolutionNote }) });
export const recheckIssue = (token: string, p: string, id: string, input: RecheckInput) => apiRequest<IssueDetail>(`${issue(p, id)}/recheck`, { token, method: 'POST', body: JSON.stringify(input) });
