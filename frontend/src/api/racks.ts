import { apiRequest } from './client';
import type { ProjectDevice } from './devices';

// Rack/layout endpoints return entities, not the augmented /devices response.
export type RackDevice = Omit<ProjectDevice, 'systemIds' | 'effectiveAreaId'>;
export type ProjectRack = RackDevice & { servedAreaIds: string[] };
export interface RackLayout {
  rack: ProjectRack;
  positioned: RackDevice[];
  zeroU: RackDevice[];
  unplaced: RackDevice[];
  occupiedU: number;
}
export type RackInput = Pick<ProjectRack, 'rackRole' | 'parentRackId' | 'areaId' | 'capacityU' | 'servedAreaIds'>;
export type PlacementInput = Pick<RackDevice, 'areaId' | 'rackId' | 'mountMode' | 'startU' | 'heightU'>;
const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
export const listRacks = (token: string, projectId: string) =>
  apiRequest<ProjectRack[]>(`${base(projectId)}/racks`, { token });
export const getRackLayout = (token: string, projectId: string, rackId: string) =>
  apiRequest<RackLayout>(`${base(projectId)}/racks/${encodeURIComponent(rackId)}/layout`, { token });
export const updateRack = (token: string, projectId: string, rackId: string, input: RackInput) =>
  apiRequest<ProjectRack>(`${base(projectId)}/racks/${encodeURIComponent(rackId)}`, { token, method: 'PATCH', body: JSON.stringify(input) });
export const putPlacement = (token: string, projectId: string, deviceId: string, input: PlacementInput) =>
  apiRequest<RackDevice>(`${base(projectId)}/devices/${encodeURIComponent(deviceId)}/placement`, { token, method: 'PUT', body: JSON.stringify(input) });
