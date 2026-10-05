import type { ConnectionKind, DevicePort, PortInput, PortSide, NetworkProfileInput } from './api/connections';
import type { ProjectDevice } from './api/devices';

export interface FaceOption { device: ProjectDevice; port: DevicePort; side: PortSide; key: string }

export const faceKey = (portId: string, side: PortSide) => `${portId}:${side}`;
export const supportsDevicePorts = (type: ProjectDevice['type']) =>
  ['NETWORK_OUTLET', 'PATCH_PANEL', 'SWITCH', 'AP', 'CAMERA'].includes(type);

export function availableFaces(devices: ProjectDevice[], ports: DevicePort[], editingConnectionId?: string): FaceOption[] {
  const byId = new Map(devices.map(device => [device.id.toLowerCase(), device]));
  return ports.flatMap(port => {
    const device = byId.get(port.deviceId.toLowerCase());
    if (!device) return [];
    return port.sides.filter(face => !face.connectionId || face.connectionId === editingConnectionId)
      .map(face => ({ device, port, side: face.side, key: faceKey(port.id, face.side) }));
  });
}

export function allowedKinds(a: FaceOption, b: FaceOption): ConnectionKind[] {
  if (a.port.id.toLowerCase() === b.port.id.toLowerCase()) return [];
  const terminal = (type: ProjectDevice['type']) => type === 'CAMERA' || type === 'AP';
  const route = (from: FaceOption, to: FaceOption): ConnectionKind[] => {
    if (from.device.type === 'NETWORK_OUTLET' && from.side === 'REAR' && to.device.type === 'PATCH_PANEL' && to.side === 'REAR') return ['FIXED'];
    if (from.device.type === 'PATCH_PANEL' && from.side === 'FRONT' && to.device.type === 'SWITCH') return ['PATCH'];
    if (terminal(from.device.type)) {
      if (to.device.type === 'PATCH_PANEL' && to.side === 'REAR') return ['FIXED'];
      if (to.device.type === 'NETWORK_OUTLET' && to.side === 'FRONT') return ['PATCH'];
      if (to.device.type === 'SWITCH') return ['FIXED', 'PATCH'];
    }
    return [];
  };
  return route(a, b).length ? route(a, b) : route(b, a);
}

export function connectionFaceChoices(devices: ProjectDevice[], ports: DevicePort[], editingConnectionId?: string) {
  const faces = availableFaces(devices, ports, editingConnectionId);
  const firstOptions = faces.filter(face => faces.some(other => allowedKinds(face, other).length > 0));
  return { faces, firstOptions };
}

export function missingFaceLabel(missing: { portId: string; side: PortSide } | null,
  devices: ProjectDevice[], ports: DevicePort[]): string {
  if (!missing) return 'mặt cổng chưa xác định';
  const side = { FRONT: 'Trước', REAR: 'Sau', SINGLE: 'Đơn' }[missing.side];
  const port = ports.find(item => item.id.toLowerCase() === missing.portId.toLowerCase());
  if (!port) return `cổng không còn trong danh sách (${missing.portId}) / ${side}`;
  const device = devices.find(item => item.id.toLowerCase() === port.deviceId.toLowerCase());
  return `${device?.code ?? 'thiết bị không còn trong danh sách'} / ${port.code} / ${side}`;
}

export function portPayload(code: string, description: string, isSwitch: boolean, vlan: string, poe: string): PortInput {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(normalized)) throw new Error('Mã cổng chỉ gồm chữ, số và dấu gạch ngang.');
  const result: PortInput = { code: normalized, description: description.trim() || null };
  if (isSwitch) {
    const value = vlan.trim();
    if (value && (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 4094)) throw new Error('VLAN phải là số nguyên từ 1 đến 4094.');
    result.accessVlanId = value ? Number(value) : null;
    result.poeEnabled = poe === 'true' ? true : poe === 'false' ? false : null;
  }
  return result;
}

export function networkProfilePayload(mode: string, ip: string, mac: string): NetworkProfileInput {
  if (mode !== '' && mode !== 'STATIC' && mode !== 'DHCP') throw new Error('Cách cấp IP chưa hợp lệ.');
  const addressMode = mode === 'STATIC' || mode === 'DHCP' ? mode : null;
  const ipAddress = ip.trim() || null;
  const macAddress = mac.trim().toUpperCase() || null;
  if (ipAddress && !addressMode) throw new Error('Chọn STATIC hoặc DHCP trước khi nhập IP.');
  if (ipAddress && (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ipAddress) || ipAddress.split('.').some(part => Number(part) > 255))) {
    throw new Error('IPv4 chưa hợp lệ. Ví dụ: 192.168.1.20.');
  }
  if (macAddress && !/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(macAddress)) throw new Error('MAC cần dạng AA:BB:CC:DD:EE:FF.');
  return { addressMode, ipAddress, macAddress };
}

export const vlanLabel = (value: number | null) => value === null ? 'Chưa biết' : String(value);
export const poeLabel = (value: boolean | null) => value === null ? 'Chưa biết' : value ? 'Bật' : 'Tắt';
export const hasDuplicateIpWarning = (warnings: string[] | undefined) => warnings?.includes('DUPLICATE_IP_IN_PROJECT') ?? false;
