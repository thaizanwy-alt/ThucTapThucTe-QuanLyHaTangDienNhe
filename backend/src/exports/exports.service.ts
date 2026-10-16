import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.types';
import { UserRole } from '../users/user-role.enum';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { ProjectDevice } from '../devices/project-device.entity';
import { ProjectDeviceSystem } from '../devices/project-device-system.entity';
import { RackServedArea } from '../devices/rack-served-area.entity';
import { DeviceNetworkProfile } from '../devices/device-network-profile.entity';
import { DeviceType } from '../devices/device-type.enum';
import { DevicePort } from '../connections/device-port.entity';
import { PhysicalConnection } from '../connections/physical-connection.entity';
import { ConnectionEndpoint } from '../connections/connection-endpoint.entity';
import { EndpointEnd, PortSide } from '../connections/connection.enums';
import { AcceptanceEvidence, AcceptanceSnapshot, AcceptanceStatus, ProjectAcceptance } from '../acceptances/acceptance.entities';
import { EvidenceStorage } from '../evidence/evidence.storage';
import { EXPORT_LIMITS, ExportLimits, exportLimits, fileName, pdf, pdfTable, PDF_TEXT_FEATURES, PreparedExport, RowBudget, Sheet, text, workbook } from './exports.render';

type Snapshot = { project: {code:string;name:string}; system:{code:string;name:string}; acceptance:{code:string;title:string;note:string|null;replacesId:string|null;replacementReason:string|null};
  inspections: Array<{code:string;title:string;area?:{code:string;name:string}|null;device?:{code:string;name:string}|null;
    items:Array<{code:string;title:string;result:string;note:string|null}>;issues:Array<{id:string;status:string;description:string}>}>;
  evidence:Array<{id:string;originalName:string;caption:string|null;sizeBytes:number;sha256:string}>;
  summary:{inspectionCount:number;itemCount:number;evidenceCount:number};actors:Array<{id:string;email:string}>;
  confirmedBy?:{id:string;email:string}; };
const LIMIT_FONT = join(__dirname, 'fonts', 'NotoSans.ttf');
const value = (x: unknown): x is string => typeof x === 'string';
const required = (x: unknown): x is string => value(x) && x.trim().length > 0;
const nullableText = (x: unknown): x is string | null => x === null || value(x);
const named = (x: any) => !!x && required(x.code) && required(x.name);
export function validSnapshot(x: any): x is Snapshot {
  return !!x && named(x.project) && named(x.system)
    && required(x.acceptance?.code) && required(x.acceptance?.title)
    && nullableText(x.acceptance?.note) && nullableText(x.acceptance?.replacesId)
    && nullableText(x.acceptance?.replacementReason)
    && Array.isArray(x.inspections) && x.inspections.length > 0
    && x.inspections.every((s: any) => required(s.code) && required(s.title)
      && (s.area === null || named(s.area)) && (s.device === null || named(s.device))
      && Array.isArray(s.items) && s.items.length > 0
      && s.items.every((i: any) => required(i.code) && required(i.title) && i.result === 'PASS' && nullableText(i.note))
      && Array.isArray(s.issues) && s.issues.every((i: any) => required(i.id) && required(i.description) && i.status === 'CLOSED'))
    && Array.isArray(x.evidence) && x.evidence.every((f: any) => required(f.id) && required(f.originalName)
      && nullableText(f.caption) && Number.isSafeInteger(f.sizeBytes) && f.sizeBytes >= 0 && /^[a-f0-9]{64}$/i.test(f.sha256))
    && x.summary?.inspectionCount === x.inspections.length
    && x.summary?.itemCount === x.inspections.reduce((n: number, s: any) => n + s.items.length, 0)
    && x.summary?.evidenceCount === x.evidence.length
    && Array.isArray(x.actors) && x.actors.every((a: any) => required(a.id) && required(a.email))
    && required(x.confirmedBy?.id) && required(x.confirmedBy?.email);
}
function manager(user: AuthenticatedUser) { if (user.role !== UserRole.MANAGER) throw new ForbiddenException(); }
function ordered<T extends {code:string}>(items:T[]) { return items.sort((a,b)=>a.code.localeCompare(b.code)); }
function mark(value: string | number | boolean | null | undefined) { return value === null || value === undefined ? 'Chưa khai báo' : typeof value === 'boolean' ? value ? 'Bật' : 'Tắt' : text(value); }

@Injectable()
export class ExportsService {
  private readonly limits: ExportLimits;
  constructor(private readonly db: DataSource, private readonly storage: EvidenceStorage,
    @Optional() @Inject(EXPORT_LIMITS) options?: Partial<ExportLimits>) { this.limits = exportLimits(options); }
  private read<T>(action: (m:EntityManager)=>Promise<T>) {
    return this.db.transaction('REPEATABLE READ', async m => { await m.query('SET TRANSACTION READ ONLY'); return action(m); });
  }
  private async project(m:EntityManager, id:string) {
    const project=await m.findOneBy(Project,{id});
    if(!project)throw new NotFoundException('Project not found');
    return project;
  }
  private async integrity(key:string|null, expected:{sha256:string;sizeBytes:number}) {
    if (!key) return 'THIẾU LIÊN KẾT FILE';
    if(!/^[a-f0-9-]{36}$/.test(key)) return 'KHÔNG THỂ KIỂM TRA';
    try {
      const path=join(await this.storage.root(),'files',key);
      try { await stat(path); } catch(e) { return (e as NodeJS.ErrnoException).code==='ENOENT'?'THIẾU FILE':'KHÔNG THỂ KIỂM TRA'; }
      const handle=await this.storage.content(key);
      try { let size=0;const hash=createHash('sha256');for await(const data of handle.createReadStream({autoClose:false})){size+=data.length;hash.update(data);}
        return size===expected.sizeBytes&&hash.digest('hex')===expected.sha256?'KHỚP SHA-256':'SAI SHA-256';
      } finally { await handle.close(); }
    } catch { return 'KHÔNG THỂ KIỂM TRA'; }
  }
  async acceptancePdf(projectId:string,id:string,user:AuthenticatedUser):Promise<PreparedExport> {
    manager(user); const at=new Date();
    const source=await this.read(async m=>{
      await this.project(m,projectId);
      const a=await m.findOneBy(ProjectAcceptance,{projectId,id});
      if(!a)throw new NotFoundException('Acceptance not found');
      if(a.status!==AcceptanceStatus.CONFIRMED)throw new ConflictException('Only confirmed acceptance can be exported');
      const s=await m.findOneBy(AcceptanceSnapshot,{projectId,acceptanceId:a.id});
      if(!s||s.schemaVersion!==1||!validSnapshot(s.content))throw new ConflictException('Acceptance snapshot unavailable or unsupported');
      const next=await m.findOneBy(ProjectAcceptance,{projectId,replacesId:a.id,status:AcceptanceStatus.CONFIRMED});
      const pins=await m.findBy(AcceptanceEvidence,{projectId,acceptanceId:a.id});
      return {snapshot:s.content as Snapshot,snapshotAt:s.createdAt,nextCode:next?.code??null,pins};
    });
    const checks: Array<{ file: Snapshot['evidence'][number]; state: string }> = [];
    for(const f of source.snapshot.evidence){const pin=source.pins.find(p=>p.evidenceId===f.id);
      checks.push({file:f,state:await this.integrity(pin?.pinnedStorageKey??null,f)});}
    const name=fileName(source.snapshot.acceptance.code,'nghiem-thu',at)+'.pdf';
    return pdf(name, LIMIT_FONT, async (doc, checkpoint) => {
      const line = async (label: string, body: unknown) => {
        doc.fontSize(10).text(label + ': ' + text(body), 45, doc.y, { width: 505, features: PDF_TEXT_FEATURES });
        doc.moveDown(0.35); await checkpoint();
      };
      doc.fontSize(17).text('HỒ SƠ NGHIỆM THU', 45, doc.y, { features: PDF_TEXT_FEATURES }); doc.moveDown();
      await line('Mã hồ sơ', source.snapshot.acceptance.code);
      await line('Tên hồ sơ', source.snapshot.acceptance.title);
      await line('Công trình', source.snapshot.project.code + ' - ' + source.snapshot.project.name);
      await line('Hệ thống', source.snapshot.system.code + ' - ' + source.snapshot.system.name);
      await line('Thời điểm ghi snapshot UTC', source.snapshotAt.toISOString());
      await line('Xuất lúc UTC', at.toISOString());
      await line('Trạng thái thay thế tại lúc xuất', source.nextCode ? 'Bản lịch sử, đã được thay bằng ' + source.nextCode : 'Chưa có bản thay thế xác nhận');
      if (source.snapshot.acceptance.replacesId) await line('Thay thế hồ sơ', source.snapshot.acceptance.replacesId);
      if (source.snapshot.acceptance.replacementReason) await line('Lý do thay thế', source.snapshot.acceptance.replacementReason);
      if (source.snapshot.acceptance.note) await line('Ghi chú hồ sơ', source.snapshot.acceptance.note);
      await line('Phạm vi', source.snapshot.summary.inspectionCount + ' phiếu, ' + source.snapshot.summary.itemCount + ' mục, ' + source.snapshot.summary.evidenceCount + ' minh chứng');
      doc.text('Chỉ xác nhận các phiếu được chọn. Không kết luận toàn bộ hệ thống hoặc công trình. Chưa có chữ ký khách hàng.', 45, doc.y, { width: 505, features: PDF_TEXT_FEATURES }); doc.moveDown();
      for (const sheet of source.snapshot.inspections) {
        doc.fontSize(12).text('PHIẾU ' + sheet.code + ' - ' + sheet.title, 45, doc.y, { width: 505, features: PDF_TEXT_FEATURES });
        await line('Vị trí', sheet.area ? sheet.area.code + ' - ' + sheet.area.name : sheet.device ? sheet.device.code + ' - ' + sheet.device.name : 'Không gắn khu vực/thiết bị');
        function* rows(): Generator<[string, string]> {
          for (const item of sheet.items) yield [item.code + ' - ' + item.title, item.result + (item.note ? ' - ' + item.note : '')];
        }
        await pdfTable(doc, rows(), checkpoint);
        for (const issue of sheet.issues) await line('Lỗi ' + issue.id, issue.status + ' - ' + issue.description);
        doc.moveDown();
      }
      doc.fontSize(12).text('MINH CHỨNG (CHỈ METADATA)', 45, doc.y, { width: 505, features: PDF_TEXT_FEATURES });
      for (const { file, state } of checks) await line(file.originalName, file.sizeBytes + ' byte · ' + (file.caption ?? 'Không chú thích') + ' · SHA-256 ' + file.sha256 + ' · ' + state);
      await line('Người xác nhận', source.snapshot.confirmedBy?.email ?? 'Chưa ghi nhận');
    }, this.limits);
  }

  private async current(projectId: string, kind: 'devices' | 'connections') {
    return this.read(async m => {
      const at = new Date(), project = await this.project(m, projectId);
      // Count all output rows before loading sources, in this same snapshot.
      const query = kind === 'devices' ? `
        SELECT 7 + count(*) + count(*) FILTER (WHERE type = 'RACK') AS rows
        FROM project_devices WHERE project_id = $1` : `
        SELECT 8
          + (SELECT COALESCE(sum(CASE WHEN d.type IN ('NETWORK_OUTLET','PATCH_PANEL') THEN 2
                    WHEN d.type IN ('SWITCH','CAMERA','AP') THEN 1 ELSE 0 END),0)
             FROM device_ports p JOIN project_devices d ON d.project_id=p.project_id AND d.id=p.device_id WHERE p.project_id=$1)
          + (SELECT count(*) FROM physical_connections WHERE project_id=$1)
          + (SELECT count(*) FROM device_ports p JOIN project_devices d ON d.project_id=p.project_id AND d.id=p.device_id
             WHERE p.project_id=$1 AND d.type IN ('NETWORK_OUTLET','CAMERA','AP'))
          + (SELECT count(*) FROM project_devices d WHERE d.project_id=$1 AND d.type IN ('NETWORK_OUTLET','CAMERA','AP')
             AND NOT EXISTS (SELECT 1 FROM device_ports p WHERE p.project_id=d.project_id AND p.device_id=d.id)) AS rows`;
      new RowBudget(this.limits.maxRows).add(Number((await m.query(query, [projectId]))[0].rows));
      const devices = kind === 'devices' ? await m.findBy(ProjectDevice, { projectId }) :
        await m.getRepository(ProjectDevice).createQueryBuilder('d').where('d.project_id = :projectId', { projectId })
          .andWhere(`(d.type IN ('NETWORK_OUTLET','CAMERA','AP')
            OR EXISTS (SELECT 1 FROM device_ports p WHERE p.project_id=d.project_id AND p.device_id=d.id)
            OR EXISTS (SELECT 1 FROM project_devices child JOIN device_ports p ON p.project_id=child.project_id AND p.device_id=child.id
                       WHERE child.project_id=d.project_id AND child.rack_id=d.id))`).getMany();
      const links = kind === 'devices' ? await m.findBy(ProjectDeviceSystem, { projectId }) : [];
      const served = kind === 'devices' ? await m.findBy(RackServedArea, { projectId }) : [];
      const areaIds = [...new Set([...devices.map(d => d.areaId), ...served.map(s => s.areaId)].filter((id): id is string => !!id))];
      const systemIds = [...new Set(links.map(l => l.systemId))];
      const areas = kind === 'devices' && areaIds.length ? await m.findBy(ProjectArea, { projectId, id: In(areaIds) }) : [];
      const systems = systemIds.length ? await m.findBy(ProjectSystem, { projectId, id: In(systemIds) }) : [];
      const profiles = kind === 'devices' ? await m.findBy(DeviceNetworkProfile, { projectId }) : [];
      const ports = kind === 'connections' ? await m.findBy(DevicePort, { projectId }) : [];
      const connections = kind === 'connections' ? await m.findBy(PhysicalConnection, { projectId }) : [];
      const endpoints = kind === 'connections' ? await m.findBy(ConnectionEndpoint, { projectId }) : [];
      return { project, devices, areas, systems, links, served, profiles, ports, connections, endpoints, at };
    });
  }
  private info(project:Project,at:Date):Sheet {return {name:'Thông tin',columns:['Thuộc tính','Giá trị'],rows:[
    ['Phạm vi',`${project.code} — ${project.name}`],['Nguồn','Dữ liệu hiện tại, không phải snapshot nghiệm thu'],
    ['Thời điểm đọc UTC',at.toISOString()],['Thời điểm xuất UTC',new Date().toISOString()]]};}
  async devicesWorkbook(projectId:string,user:AuthenticatedUser):Promise<PreparedExport> {
    manager(user);const g=await this.current(projectId, 'devices');
    const budget = new RowBudget(this.limits.maxRows); budget.add(7);
    const byDevice=new Map(g.devices.map(d=>[d.id,d]));const byArea=new Map(g.areas.map(a=>[a.id,a.code]));const bySystem=new Map(g.systems.map(s=>[s.id,s.code]));
    const profiles=new Map(g.profiles.map(p=>[p.deviceId,p]));
    const rows=ordered(g.devices).map(d=>{budget.add();
      const rack=d.rackId?byDevice.get(d.rackId):null, p=profiles.get(d.id);
      return [d.code,d.name,d.type,d.brand,d.model,d.serialNumber,
        g.links.filter(l=>l.deviceId===d.id).map(l=>bySystem.get(l.systemId)??'').sort().join(', '),
        d.areaId?byArea.get(d.areaId)??null:null,
        d.rackId?byArea.get(rack?.areaId??'')??null:byArea.get(d.areaId??'')??null,
        d.locationNote,rack?.code??null,d.mountMode,mark(d.startU),mark(d.heightU),p?.addressMode??null,p?.ipAddress??null,p?.macAddress??null];
    });
    const racks=ordered(g.devices.filter(d=>d.type===DeviceType.RACK)).map(r=>{budget.add();return [r.code,r.rackRole,byDevice.get(r.parentRackId??'')?.code??null,
      byArea.get(r.areaId??'')??null,mark(r.capacityU),g.served.filter(s=>s.rackId===r.id).map(s=>byArea.get(s.areaId)??'').sort().join(', ')];});
    return workbook(fileName(g.project.code,'thiet-bi',g.at)+'.xlsx',[this.info(g.project,g.at),
      {name:'Thiết bị',columns:['Mã','Tên','Loại','Hãng','Model','Serial','System','Area trực tiếp','Area hiệu lực','Ghi chú vị trí','Rack','Kiểu xếp','U bắt đầu','Chiều cao U','Chế độ IP','IP','MAC'],rows},
      {name:'Tủ',columns:['Mã','Vai trò','Tủ cha','Area đặt','Sức chứa U','Area phục vụ'],rows:racks}], this.limits);
  }
  async connectionsWorkbook(projectId:string,user:AuthenticatedUser):Promise<PreparedExport> {
    manager(user);const g=await this.current(projectId, 'connections');
    const budget = new RowBudget(this.limits.maxRows); budget.add(8);
    const device=new Map(g.devices.map(d=>[d.id,d]));const port=new Map(g.ports.map(p=>[p.id,p]));
    const byConnection=new Map(g.connections.map(c=>[c.id,c]));
    const face=(id:string,side:PortSide)=>g.endpoints.find(e=>e.portId===id&&e.side===side);
    const label=(id:string)=>{const p=port.get(id);return p?`${device.get(p.deviceId)?.code??'?'} / ${p.code}`:'Cổng không tồn tại';};
    const sides=(d:ProjectDevice):PortSide[]=>[DeviceType.NETWORK_OUTLET,DeviceType.PATCH_PANEL].includes(d.type)?[PortSide.FRONT,PortSide.REAR]:[DeviceType.SWITCH,DeviceType.CAMERA,DeviceType.AP].includes(d.type)?[PortSide.SINGLE]:[];
    const ports=ordered(g.ports).flatMap(p=>sides(device.get(p.deviceId)!).map(side=>{budget.add();return [device.get(p.deviceId)!.code,p.code,p.description,side,face(p.id,side)?.connectionId??'Trống',mark(p.accessVlanId),mark(p.poeEnabled)];}));
    const wires=g.connections.sort((a,b)=>a.id.localeCompare(b.id)).map(c=>{budget.add();const a=g.endpoints.find(e=>e.connectionId===c.id&&e.end===EndpointEnd.A),b=g.endpoints.find(e=>e.connectionId===c.id&&e.end===EndpointEnd.B);
      return [c.label,c.kind,c.version,a?label(a.portId):'Thiếu A',a?.side??null,b?label(b.portId):'Thiếu B',b?.side??null];});
    const traces:(string|number|null)[][]=[];
    for(const d of ordered(g.devices.filter(d=>[DeviceType.NETWORK_OUTLET,DeviceType.CAMERA,DeviceType.AP].includes(d.type)))){
      const sourcePorts=ordered(g.ports.filter(p=>p.deviceId===d.id));
      if(!sourcePorts.length){budget.add();traces.push([d.code,'Không có cổng','', 'Thiếu cổng',null,null,null,null]);}
      for(const first of sourcePorts){budget.add();let current=first.id,side=d.type===DeviceType.NETWORK_OUTLET?PortSide.REAR:PortSide.SINGLE;
        const seen=new Set<string>(),segments:string[]=[],panels:string[]=[],racks:string[]=[];let end:DevicePort|null=null,missing='';
        while(true){const key=`${current}:${side}`;if(seen.has(key)){missing='Vòng lặp';break;}seen.add(key);
          const e=face(current,side);if(!e){missing=`${label(current)} / ${side}`;break;}
          const other=g.endpoints.find(x=>x.connectionId===e.connectionId&&x.end!==e.end);
          if(!other){missing='Thiếu endpoint';break;}
          const target=port.get(other.portId);if(!target){missing='Thiếu cổng đích';break;}
          const targetDevice=device.get(target.deviceId);if(!targetDevice){missing='Thiếu thiết bị đích';break;}
          segments.push(`${label(current)} / ${side} → ${label(target.id)} / ${other.side} (${byConnection.get(e.connectionId)?.kind??'?'})`);
          if(targetDevice.rackId)racks.push(device.get(targetDevice.rackId)?.code??'');
          if(targetDevice.type===DeviceType.PATCH_PANEL)panels.push(`${targetDevice.code}/${target.code}`);
          if(targetDevice.type===DeviceType.SWITCH){end=target;break;}
          current=target.id;
          if(targetDevice.type===DeviceType.NETWORK_OUTLET&&other.side===PortSide.FRONT)side=PortSide.REAR;
          else if(targetDevice.type===DeviceType.PATCH_PANEL&&other.side===PortSide.REAR)side=PortSide.FRONT;
          else {missing=`${label(current)} / ${other.side} (chưa hỗ trợ đoạn tiếp)`;break;}
        }
        traces.push([d.code,first.code,segments.join(' | '),end?'Đủ khai báo tới switch':`Thiếu: ${missing}`,panels.join(', '),racks.join(', '),end?label(end.id):null,end?`${mark(end.accessVlanId)} / ${mark(end.poeEnabled)}`:null]);
      }
    }
    return workbook(fileName(g.project.code,'dau-noi',g.at)+'.xlsx',[this.info(g.project,g.at),
      {name:'Cổng',columns:['Thiết bị','Mã cổng','Mô tả','Mặt','Connection ID/Trạng thái','VLAN','PoE'],rows:ports},
      {name:'Dây',columns:['Nhãn','Loại','Version','Đầu A','Mặt A','Đầu B','Mặt B'],rows:wires},
      {name:'Tra cứu',columns:['Thiết bị nguồn','Cổng nguồn','Các đoạn dây','Độ đầy đủ','Panel/port','Rack qua đường','Switch/port','VLAN / PoE'],rows:traces}], this.limits);
  }
}
