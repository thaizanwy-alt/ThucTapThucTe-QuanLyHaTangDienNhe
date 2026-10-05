import type { DeviceInput, DeviceType, DeviceUpdate, ProjectDevice } from './api/devices';

export const deviceLabels: Record<DeviceType, string> = {
  RACK: 'Tủ rack', PATCH_PANEL: 'Patch panel', SWITCH: 'Switch',
  NETWORK_OUTLET: 'Ổ mạng', AP: 'AP WiFi', CAMERA: 'Camera',
  UPS: 'UPS', PDU: 'PDU', NVR: 'NVR', ROUTER: 'Router', ODF: 'ODF',
  CABLE_MANAGER: 'Thanh quản lý cáp', SHELF: 'Khay đỡ',
};

export const isRackable = (type: DeviceType) =>
  ['SWITCH', 'PATCH_PANEL', 'UPS', 'PDU', 'NVR', 'ROUTER', 'ODF', 'CABLE_MANAGER', 'SHELF'].includes(type);

export interface DeviceDraft {
  type: DeviceType;
  code: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  description: string;
  locationNote: string;
  placement: 'none' | 'area' | 'rack';
  areaId: string;
  rackId: string;
  capacityU: string;
  systemIds: string[];
}

export function deviceDraft(device?: ProjectDevice): DeviceDraft {
  return {
    type: device?.type ?? 'RACK', code: device?.code ?? '', name: device?.name ?? '',
    brand: device?.brand ?? '', model: device?.model ?? '', serialNumber: device?.serialNumber ?? '',
    description: device?.description ?? '', locationNote: device?.locationNote ?? '',
    placement: device?.rackId ? 'rack' : device?.areaId ? 'area' : 'none',
    areaId: device?.areaId ?? '', rackId: device?.rackId ?? '',
    capacityU: device?.capacityU?.toString() ?? '', systemIds: [...(device?.systemIds ?? [])],
  };
}

export function devicePayload(draft: DeviceDraft, editing: boolean): DeviceInput | DeviceUpdate {
  const code = draft.code.trim().toUpperCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)) throw new Error('Mã nhãn chỉ gồm chữ, số và dấu gạch ngang giữa các nhóm.');
  if (!draft.name.trim()) throw new Error('Nhập tên thiết bị.');
  if (draft.placement === 'area' && !draft.areaId) throw new Error('Chọn tầng hoặc phòng đặt thiết bị.');
  if (draft.placement === 'rack' && (!isRackable(draft.type) || !draft.rackId)) {
    throw new Error('Chọn rack cho loại thiết bị hỗ trợ lắp trong tủ.');
  }
  const capacityU = draft.type === 'RACK' && draft.capacityU.trim() ? Number(draft.capacityU) : null;
  if (capacityU !== null && (!Number.isInteger(capacityU) || capacityU < 1 || capacityU > 2147483647)) {
    throw new Error('Dung lượng rack phải là số nguyên từ 1 đến 2147483647 U.');
  }
  return {
    ...(editing ? {} : { type: draft.type }), code, name: draft.name.trim(),
    brand: draft.brand.trim() || null, model: draft.model.trim() || null,
    serialNumber: draft.serialNumber.trim() || null, description: draft.description.trim() || null,
    locationNote: draft.locationNote.trim() || null, capacityU,
    // Send both location fields to clear the previous placement in the same PATCH.
    areaId: draft.placement === 'area' ? draft.areaId : null,
    rackId: draft.placement === 'rack' ? draft.rackId : null,
    systemIds: [...draft.systemIds],
  };
}
