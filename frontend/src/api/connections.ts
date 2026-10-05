import { apiRequest } from './client';
import type { DeviceType } from './devices';
import type { ProjectArea } from './projects';

export type PortSide = 'FRONT' | 'REAR' | 'SINGLE';
export type ConnectionKind = 'FIXED' | 'PATCH';

export interface DevicePort {
  id: string;
  projectId: string;
  deviceId: string;
  code: string;
  description: string | null;
  accessVlanId: number | null;
  poeEnabled: boolean | null;
  sides: { side: PortSide; connectionId: string | null }[];
}

export interface DeviceSummary {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  areaId: string | null;
  rackId: string | null;
  effectiveAreaId: string | null;
  area: ProjectArea | null;
  rack: { id: string; code: string; name: string; areaId: string | null } | null;
}

export interface ConnectionEndpoint {
  portId: string;
  side: PortSide;
  port: Pick<DevicePort, 'id' | 'code' | 'description' | 'accessVlanId' | 'poeEnabled'>;
  device: DeviceSummary;
}

export interface PhysicalConnection {
  id: string;
  projectId: string;
  kind: ConnectionKind;
  version: number;
  label: string | null;
  description: string | null;
  a: ConnectionEndpoint;
  b: ConnectionEndpoint;
}

export interface NetworkProfile {
  projectId: string;
  deviceId: string;
  addressMode: 'STATIC' | 'DHCP' | null;
  ipAddress: string | null;
  macAddress: string | null;
  createdAt: string;
  updatedAt: string;
  warnings: string[];
}

export type NetworkProfileInput = Pick<NetworkProfile, 'addressMode' | 'ipAddress' | 'macAddress'>;
export type PortInput = { code: string; description?: string | null; accessVlanId?: number | null; poeEnabled?: boolean | null };
export type PortUpdate = Partial<PortInput>;
export type EndpointInput = Pick<ConnectionEndpoint, 'portId' | 'side'>;
export type ConnectionInput = { kind: ConnectionKind; a: EndpointInput; b: EndpointInput; label?: string | null; description?: string | null };
export type RewireInput = Pick<ConnectionInput, 'kind' | 'a' | 'b'> & { expectedVersion: number };

export interface ConnectionTrace {
  device: DeviceSummary;
  area: ProjectArea | null;
  networkProfile: Omit<NetworkProfile, 'warnings'> | null;
  paths: {
    port: Omit<DevicePort, 'sides'>;
    segments: { connectionId: string; kind: ConnectionKind; version: number; from: ConnectionEndpoint; to: ConnectionEndpoint }[];
    complete: boolean;
    missing: { portId: string; side: PortSide } | null;
    switchPort: { portId: string; accessVlanId: number | null; poeEnabled: boolean | null } | null;
  }[];
}

const root = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const portPath = (projectId: string, deviceId: string, portId?: string) =>
  `${root(projectId)}/devices/${encodeURIComponent(deviceId)}/ports${portId ? `/${encodeURIComponent(portId)}` : ''}`;
const connectionPath = (projectId: string, connectionId?: string) =>
  `${root(projectId)}/connections${connectionId ? `/${encodeURIComponent(connectionId)}` : ''}`;
const profilePath = (projectId: string, deviceId: string) =>
  `${root(projectId)}/devices/${encodeURIComponent(deviceId)}/network-profile`;

export const listPorts = (token: string, projectId: string, deviceId: string) =>
  apiRequest<DevicePort[]>(portPath(projectId, deviceId), { token });
export const createPort = (token: string, projectId: string, deviceId: string, body: PortInput) =>
  apiRequest<DevicePort>(portPath(projectId, deviceId), { token, method: 'POST', body: JSON.stringify(body) });
export const updatePort = (token: string, projectId: string, deviceId: string, portId: string, body: PortUpdate) =>
  apiRequest<DevicePort>(portPath(projectId, deviceId, portId), { token, method: 'PATCH', body: JSON.stringify(body) });
export const deletePort = (token: string, projectId: string, deviceId: string, portId: string) =>
  apiRequest<void>(portPath(projectId, deviceId, portId), { token, method: 'DELETE' });
export const listConnections = (token: string, projectId: string) =>
  apiRequest<PhysicalConnection[]>(connectionPath(projectId), { token });
export const createConnection = (token: string, projectId: string, body: ConnectionInput) =>
  apiRequest<PhysicalConnection>(connectionPath(projectId), { token, method: 'POST', body: JSON.stringify(body) });
export const rewireConnection = (token: string, projectId: string, id: string, body: RewireInput) =>
  apiRequest<PhysicalConnection>(`${connectionPath(projectId, id)}/rewire`, { token, method: 'POST', body: JSON.stringify(body) });
export const deleteConnection = (token: string, projectId: string, id: string) =>
  apiRequest<void>(connectionPath(projectId, id), { token, method: 'DELETE' });
export const traceConnection = (token: string, projectId: string, deviceCode: string) =>
  apiRequest<ConnectionTrace>(`${connectionPath(projectId)}/trace?deviceCode=${encodeURIComponent(deviceCode)}`, { token });
export const getNetworkProfile = (token: string, projectId: string, deviceId: string) =>
  apiRequest<NetworkProfile | null>(profilePath(projectId, deviceId), { token });
export const putNetworkProfile = (token: string, projectId: string, deviceId: string, body: NetworkProfileInput) =>
  apiRequest<NetworkProfile>(profilePath(projectId, deviceId), { token, method: 'PUT', body: JSON.stringify(body) });
