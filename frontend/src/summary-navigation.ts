import type { Inspection } from './api/inspections';
import type { Acceptance } from './api/acceptances';
import type { ProjectTask } from './api/tasks';

export type SummaryGroup = 'notApproved' | 'notClosed' | 'passed' | 'notChecked' | 'pendingOrFailed' | 'draft' | 'confirmedCurrent' | 'superseded';
export type SummaryDestination = { section: 'tasks' | 'inspections'; group: SummaryGroup };

export const taskGroups = [{ value: 'notApproved', label: 'Chưa duyệt', matches: (row: ProjectTask) => row.status !== 'APPROVED' }];
export const issueGroups = [{ value: 'notClosed', label: 'Chưa đóng', matches: (row: { status: string }) => row.status !== 'CLOSED' }];

export function inspectionGroup(row: Pick<Inspection, 'passed' | 'summary'>): SummaryGroup {
  if (row.passed) return 'passed';
  return row.summary.total > 0 && row.summary.notChecked === row.summary.total && row.summary.openIssues === 0
    ? 'notChecked' : 'pendingOrFailed';
}
export const inspectionGroups = [
  { value: 'passed', label: 'Đạt' },
  { value: 'notChecked', label: 'Chưa kiểm tra' },
  { value: 'pendingOrFailed', label: 'Đang kiểm tra / chưa đạt' },
].map(group => ({ ...group, matches: (row: Inspection) => inspectionGroup(row) === group.value }));

export const acceptanceGroups = [
  { value: 'draft', label: 'Bản nháp', matches: (row: Acceptance) => row.status === 'DRAFT' },
  { value: 'confirmedCurrent', label: 'Xác nhận hiện hành', matches: (row: Acceptance) => row.status === 'CONFIRMED' && !row.replacedById },
  { value: 'superseded', label: 'Đã thay thế', matches: (row: Acceptance) => row.status === 'CONFIRMED' && Boolean(row.replacedById) },
];
export function summaryView(group?: SummaryGroup) {
  return group === 'draft' || group === 'confirmedCurrent' || group === 'superseded' ? 'acceptances' : 'checks';
}
