import { apiRequest } from './client';

export type DeviceType = 'RACK' | 'PATCH_PANEL' | 'SWITCH' | 'NETWORK_OUTLET' | 'AP' | 'CAMERA'
  | 'UPS' | 'PDU' | 'NVR' | 'ROUTER' | 'ODF' | 'CABLE_MANAGER' | 'SHELF';

export interface ProjectDevice {
  id: string;
  projectId: string;
  type: DeviceType;
  code: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  description: string | null;
  locationNote: string | null;
  areaId: string | null;
  rackId: string | null;
  capacityU: number | null;
  rackRole: 'MAIN' | 'SUB' | null;
  parentRackId: string | null;
  mountMode: 'U' | 'ZERO_U' | null;
  startU: number | null;
  heightU: number | null;
  systemIds: string[];
  effectiveAreaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DeviceInput = Pick<ProjectDevice, 'type' | 'code' | 'name'> & Partial<Pick<ProjectDevice,
  'brand' | 'model' | 'serialNumber' | 'description' | 'locationNote' | 'areaId' | 'rackId' | 'capacityU' | 'systemIds'>>;
export type DeviceUpdate = Partial<Omit<DeviceInput, 'type'>>;

const path = (projectId: string, deviceId?: string) =>
  `/projects/${encodeURIComponent(projectId)}/devices${deviceId ? `/${encodeURIComponent(deviceId)}` : ''}`;

export const listDevices = (token: string, projectId: string) =>
  apiRequest<ProjectDevice[]>(path(projectId), { token });
export const createDevice = (token: string, projectId: string, input: DeviceInput) =>
  apiRequest<ProjectDevice>(path(projectId), { token, method: 'POST', body: JSON.stringify(input) });
export const updateDevice = (token: string, projectId: string, id: string, input: DeviceUpdate) =>
  apiRequest<ProjectDevice>(path(projectId, id), { token, method: 'PATCH', body: JSON.stringify(input) });
export const deleteDevice = (token: string, projectId: string, id: string) =>
  apiRequest<void>(path(projectId, id), { token, method: 'DELETE' });
