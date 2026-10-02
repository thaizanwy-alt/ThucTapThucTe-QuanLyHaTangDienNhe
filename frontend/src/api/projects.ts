import { apiRequest } from './client';

export type ProjectStatus = 'PLANNING' | 'IN_PROGRESS' | 'WAITING_ACCEPTANCE' | 'COMPLETED';
export type AreaType = 'FLOOR' | 'ROOM';
export type SystemCategory = 'LAN' | 'WIFI' | 'CAMERA';

export interface Project {
  id: string;
  code: string;
  name: string;
  address: string | null;
  status: ProjectStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectArea {
  id: string;
  projectId: string;
  parentId: string | null;
  type: AreaType;
  code: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSystem {
  id: string;
  projectId: string;
  code: string;
  name: string;
  category: SystemCategory;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectInput = Pick<Project, 'code' | 'name'> & {
  address?: string | null;
  status?: ProjectStatus;
  description?: string | null;
};

export type AreaInput = Pick<ProjectArea, 'code' | 'name' | 'type'> & {
  parentId?: string | null;
  sortOrder?: number;
};

export type AreaUpdate = Partial<Pick<ProjectArea, 'code' | 'name' | 'parentId' | 'sortOrder'>>;
export type SystemInput = Pick<ProjectSystem, 'code' | 'name' | 'category'> & { description?: string | null };
export type SystemUpdate = Partial<SystemInput>;

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

export const listProjects = (token: string) => apiRequest<Project[]>('/projects', { token });
export const createProject = (token: string, input: ProjectInput) =>
  apiRequest<Project>('/projects', { token, method: 'POST', body: JSON.stringify(input) });
export const updateProject = (token: string, id: string, input: Partial<ProjectInput>) =>
  apiRequest<Project>(projectPath(id), { token, method: 'PATCH', body: JSON.stringify(input) });

export const listAreas = (token: string, projectId: string) =>
  apiRequest<ProjectArea[]>(`${projectPath(projectId)}/areas`, { token });
export const createArea = (token: string, projectId: string, input: AreaInput) =>
  apiRequest<ProjectArea>(`${projectPath(projectId)}/areas`, { token, method: 'POST', body: JSON.stringify(input) });
export const updateArea = (token: string, projectId: string, areaId: string, input: AreaUpdate) =>
  apiRequest<ProjectArea>(`${projectPath(projectId)}/areas/${encodeURIComponent(areaId)}`, {
    token, method: 'PATCH', body: JSON.stringify(input),
  });
export const deleteArea = (token: string, projectId: string, areaId: string) =>
  apiRequest<void>(`${projectPath(projectId)}/areas/${encodeURIComponent(areaId)}`, { token, method: 'DELETE' });

export const listSystems = (token: string, projectId: string) =>
  apiRequest<ProjectSystem[]>(`${projectPath(projectId)}/systems`, { token });
export const createSystem = (token: string, projectId: string, input: SystemInput) =>
  apiRequest<ProjectSystem>(`${projectPath(projectId)}/systems`, { token, method: 'POST', body: JSON.stringify(input) });
export const updateSystem = (token: string, projectId: string, systemId: string, input: SystemUpdate) =>
  apiRequest<ProjectSystem>(`${projectPath(projectId)}/systems/${encodeURIComponent(systemId)}`, {
    token, method: 'PATCH', body: JSON.stringify(input),
  });
export const deleteSystem = (token: string, projectId: string, systemId: string) =>
  apiRequest<void>(`${projectPath(projectId)}/systems/${encodeURIComponent(systemId)}`, {
    token, method: 'DELETE',
  });
