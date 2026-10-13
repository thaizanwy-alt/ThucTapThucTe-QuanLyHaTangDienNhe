import type { Acceptance, Readiness, Selection } from './api/acceptances';
export function selectionPayload(d: Selection) {
  const code=d.code.trim().toUpperCase(), title=d.title.trim();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code) || code.length>100 || !title || title.length>255) throw new Error('Mã hoặc tên hồ sơ chưa hợp lệ.');
  return {code,title,inspectionIds:[...new Set(d.inspectionIds)],evidenceIds:[...new Set(d.evidenceIds)]};
}
export const canConfirm = (row: Acceptance, ready: Readiness | null, manager: boolean) => manager && row.status==='DRAFT' && !!ready?.eligible && row.version===ready.version;
export function blockerLabel(value: string) {
  const [kind,id]=value.split(':');
  return ({NO_INSPECTIONS:'Chưa chọn phiếu',EMPTY_INSPECTION:'Phiếu không có mục',ITEM_NOT_PASS:'Mục chưa PASS',ISSUE_NOT_CLOSED:'Lỗi chưa CLOSED'} as Record<string,string>)[kind] + (id ? ` (${id})` : '');
}
export class AcceptanceGate {
  private revision=0;
  next(){return ++this.revision;}
  current(value:number){return value===this.revision;}
}
export async function saveAcceptanceAndRefresh(write:()=>Promise<unknown>, committed:()=>void, refresh:()=>Promise<unknown>, active:()=>boolean=()=>true) {
  await write();
  if(!active())return null;
  committed();
  try { await refresh(); return true; } catch { return false; }
}
