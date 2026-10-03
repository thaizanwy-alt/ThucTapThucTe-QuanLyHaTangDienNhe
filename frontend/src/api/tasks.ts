import { apiRequest } from './client';

export type TaskStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'RETURNED' | 'APPROVED';

export interface ProjectTask {
  id: string;
  projectId: string;
  systemId: string;
  areaId: string | null;
  assigneeId: string;
  code: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  completionNote: string | null;
  returnReason: string | null;
  submittedAt: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Technician {
  id: string;
  email: string;
}

export type TaskInput = Pick<ProjectTask, 'code' | 'title' | 'systemId' | 'assigneeId'> & {
  areaId?: string | null;
  description?: string | null;
};

const taskPath = (projectId: string, taskId?: string) =>
  `/projects/${encodeURIComponent(projectId)}/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ''}`;

export const listTasks = (token: string, projectId: string) =>
  apiRequest<ProjectTask[]>(taskPath(projectId), { token });
export const listTechnicians = (token: string) =>
  apiRequest<Technician[]>('/users/technicians', { token });
export const createTask = (token: string, projectId: string, input: TaskInput) =>
  apiRequest<ProjectTask>(taskPath(projectId), { token, method: 'POST', body: JSON.stringify(input) });
export const updateTask = (token: string, projectId: string, taskId: string, input: Partial<TaskInput>) =>
  apiRequest<ProjectTask>(taskPath(projectId, taskId), { token, method: 'PATCH', body: JSON.stringify(input) });
export const startTask = (token: string, projectId: string, taskId: string) =>
  apiRequest<ProjectTask>(`${taskPath(projectId, taskId)}/start`, { token, method: 'POST' });
export const submitTask = (token: string, projectId: string, taskId: string, completionNote: string) =>
  apiRequest<ProjectTask>(`${taskPath(projectId, taskId)}/submit`, {
    token, method: 'POST', body: JSON.stringify({ completionNote }),
  });
export const approveTask = (token: string, projectId: string, taskId: string) =>
  apiRequest<ProjectTask>(`${taskPath(projectId, taskId)}/approve`, { token, method: 'POST' });
export const returnTask = (token: string, projectId: string, taskId: string, reason: string) =>
  apiRequest<ProjectTask>(`${taskPath(projectId, taskId)}/return`, {
    token, method: 'POST', body: JSON.stringify({ reason }),
  });
