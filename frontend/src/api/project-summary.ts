import { apiRequest } from './client';
import type { TaskStatus } from './tasks';
import type { IssueStatus } from './inspections';

export interface ProjectSummaryData {
  projectId: string;
  /** Start of the read transaction, not the precise MVCC snapshot acquisition time. */
  readAt: string;
  workScope: 'PROJECT' | 'ASSIGNED_TO_ME';
  tasks: { total: number; byStatus: Record<TaskStatus, number>; notApproved: number };
  issues: { total: number; byStatus: Record<IssueStatus, number>; notClosed: number };
  inventory: {
    devicesTotal: number;
    areas: { total: number; floor: number; room: number };
    systemsTotal: number;
    racks: { total: number; main: number; sub: number; unclassified: number };
  };
  acceptances: { draft?: number; confirmedCurrent: number; superseded: number };
  inspections?: { total: number; passed: number; notChecked: number; pendingOrFailed: number };
}

export const getProjectSummary = (token: string, projectId: string, signal?: AbortSignal) =>
  apiRequest<ProjectSummaryData>(`/projects/${encodeURIComponent(projectId)}/summary`, { token, signal });
