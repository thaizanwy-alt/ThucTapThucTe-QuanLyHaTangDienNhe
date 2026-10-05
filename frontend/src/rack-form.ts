import type { PlacementInput, ProjectRack, RackDevice, RackInput } from './api/racks';

export interface RackDraft { role: string; parentId: string; areaId: string; capacity: string; servedAreaIds: string[] }
export function rackDraft(rack: ProjectRack): RackDraft {
  return { role: rack.rackRole ?? '', parentId: rack.parentRackId ?? '', areaId: rack.areaId ?? '',
    capacity: rack.capacityU?.toString() ?? '', servedAreaIds: [...rack.servedAreaIds] };
}
function integer(value: string, min: number): number {
  const number = Number(value);
  if (!value.trim() || !Number.isInteger(number) || number < min || number > 2147483647) throw new Error(`Nhập số nguyên từ ${min} đến 2147483647.`);
  return number;
}
export function rackPayload(draft: RackDraft, rackId: string, racks: ProjectRack[]): RackInput {
  if (!['', 'MAIN', 'SUB'].includes(draft.role)) throw new Error('Vai trò tủ không hợp lệ.');
  const capacityU = draft.capacity.trim() ? integer(draft.capacity, 1) : null;
  if (draft.role && (!draft.areaId || capacityU === null || !draft.servedAreaIds.length)) throw new Error('Tủ MAIN/SUB cần nơi đặt, dung lượng U và ít nhất một Area phục vụ.');
  const parentRackId = draft.role === 'SUB' ? draft.parentId : null;
  if (draft.role === 'SUB' && !racks.some(r => r.id === parentRackId && r.id !== rackId && r.rackRole === 'MAIN')) throw new Error('Chọn tủ MAIN trong công trình làm tủ cha.');
  return { rackRole: (draft.role || null) as RackInput['rackRole'], parentRackId,
    areaId: draft.areaId || null, capacityU, servedAreaIds: [...draft.servedAreaIds] };
}
export interface PlacementDraft { target: 'rack' | 'area' | 'none'; rackId: string; areaId: string; mode: 'U' | 'ZERO_U' | ''; start: string; height: string }
export function placementDraft(device: RackDevice, defaultRackId: string): PlacementDraft {
  return { target: device.rackId ? 'rack' : device.areaId ? 'area' : 'rack', rackId: device.rackId ?? defaultRackId,
    areaId: device.areaId ?? '', mode: device.mountMode ?? '', start: device.startU?.toString() ?? '', height: device.heightU?.toString() ?? '1' };
}
export function placementPayload(draft: PlacementDraft, device: RackDevice, racks: ProjectRack[]): PlacementInput {
  const input: PlacementInput = { areaId: null, rackId: null, mountMode: null, startU: null, heightU: null };
  if (draft.target === 'area') {
    if (!draft.areaId) throw new Error('Chọn nơi đặt thiết bị.');
    return { ...input, areaId: draft.areaId };
  }
  if (draft.target === 'none') return input;
  const rack = racks.find(r => r.id === draft.rackId);
  if (!rack) throw new Error('Chọn tủ rack.');
  input.rackId = rack.id;
  if (!draft.mode) return input;
  if (draft.mode === 'ZERO_U') {
    if (device.type !== 'PDU') throw new Error('Chỉ PDU được lắp ZERO_U.');
    return { ...input, mountMode: 'ZERO_U', heightU: 0 };
  }
  const heightU = integer(draft.height, 1);
  const startU = draft.start.trim() ? integer(draft.start, 1) : null;
  if (startU !== null && (rack.capacityU === null || startU + heightU - 1 > rack.capacityU)) throw new Error('Khoảng U vượt dung lượng tủ hoặc tủ chưa khai báo dung lượng.');
  return { ...input, mountMode: 'U', startU, heightU };
}

// Render a bounded window even when a legacy rack has a very large capacity.
export function elevationWindow(capacity: number, page: number, devices: RackDevice[], size = 60) {
  const pages = Math.max(1, Math.ceil(capacity / size));
  const current = Math.max(0, Math.min(page, pages - 1));
  const top = Math.max(0, capacity - current * size);
  const bottom = Math.max(1, top - size + 1);
  const units = Array.from({ length: Math.max(0, top - bottom + 1) }, (_, i) => top - i);
  const placed = devices.flatMap(device => {
    if (device.mountMode !== 'U' || device.startU == null || device.heightU == null) return [];
    const end = device.startU + device.heightU - 1;
    if (end < bottom || device.startU > top) return [];
    return [{ device, row: top - Math.min(top, end) + 1, span: Math.min(top, end) - Math.max(bottom, device.startU) + 1 }];
  });
  return { pages, current, top, bottom, units, placed };
}

// Scope changes invalidate pending requests synchronously, before effects run.
export class RackRequestGate {
  private scope = '';
  private version = 0;
  setScope(scope: string) { if (this.scope !== scope) { this.scope = scope; this.version++; } }
  begin() { return ++this.version; }
  current(ticket: number) { return ticket === this.version; }
  invalidate() { this.version++; }
}
export function visibleRackSnapshot<T extends { scope: string }>(snapshot: T | null, scope: string): T | null {
  return snapshot?.scope === scope ? snapshot : null;
}
export async function saveRackAndRefresh(write: () => Promise<unknown>, close: () => void, refresh: () => Promise<boolean>) {
  await write();
  close(); // A committed write must not leave a resubmittable form open.
  return refresh();
}
