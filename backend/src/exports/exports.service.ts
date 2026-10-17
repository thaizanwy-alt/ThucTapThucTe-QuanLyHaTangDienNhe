import { ConflictException, ForbiddenException, GatewayTimeoutException, Inject, Injectable, NotFoundException, Optional, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
import { EXPORT_LIMITS, ExportLimits, exportLimits, fileName, InputBudget, MAX_BYTES, pdf, pdfTable, PDF_TEXT_FEATURES, PreparedExport, RowBudget, Sheet, text, workbook, zipExport } from './exports.render';
import { acquireXlsxProcessSlot } from './xlsx-process-slot';

type Snapshot = { project: {code:string;name:string}; system:{code:string;name:string}; acceptance:{code:string;title:string;note:string|null;replacesId:string|null;replacementReason:string|null};
  inspections: Array<{code:string;title:string;area?:{code:string;name:string}|null;device?:{code:string;name:string}|null;
    items:Array<{code:string;title:string;result:string;note:string|null}>;issues:Array<{id:string;status:string;description:string}>}>;
  evidence:Array<{id:string;originalName:string;mimeType:string;sizeBytes:number;sha256:string;caption:string|null;uploadedById:string;createdAt:string|Date}>;
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
const evidenceExtension: Record<string,string> = { 'image/jpeg':'jpg', 'image/png':'png', 'application/pdf':'pdf' };
async function digestFile(path:string) {
  const hash=createHash('sha256'); let sizeBytes=0;
  for await (const chunk of createReadStream(path)) { sizeBytes+=chunk.length; hash.update(chunk); }
  return { sizeBytes, sha256:hash.digest('hex') };
}

type AcceptanceExportSource = { snapshot: Snapshot; snapshotAt: Date; nextCode: string | null; pins: AcceptanceEvidence[] };

@Injectable()
export class ExportsService {
  private readonly limits: ExportLimits;
  constructor(private readonly db: DataSource, private readonly storage: EvidenceStorage,
    @Optional() @Inject(EXPORT_LIMITS) options?: Partial<ExportLimits>) { this.limits = exportLimits(options); }
  private async read<T>(action: (m:EntityManager)=>Promise<T>, control?: {deadlineAt:number; signal:AbortSignal}):Promise<T> {
    if (!control) return this.db.transaction('REPEATABLE READ', async m => { await m.query('SET TRANSACTION READ ONLY'); return action(m); });
    // The package gets a private one-connection pool and PostgreSQL startup
    // timeouts. Abort closes only this local connection; server execution is
    // bounded by statement_timeout, not PID signalling.
    const exportDb=this.createPackageDataSource(Math.max(1,control.deadlineAt-Date.now()));
    let failure:unknown;
    try {
      try { await exportDb.initialize(); }
      catch(error) {
        if(Date.now()>=control.deadlineAt) throw new GatewayTimeoutException('Handover package timed out',{cause:error});
        throw new ServiceUnavailableException('Export database checkout unavailable',{cause:error});
      }
      if(Date.now()>=control.deadlineAt) throw new GatewayTimeoutException('Handover package timed out');
      if(control.signal.aborted) throw new ServiceUnavailableException('Handover package canceled');
      return await this.readPackageConnection(exportDb,action,control);
    } catch(error) { failure=error; throw error; }
    finally {
      try {
        if(exportDb.isInitialized) await exportDb.destroy();
        else if((exportDb.driver as {master?:unknown}).master) await exportDb.driver.disconnect();
      } catch(error) { if(!failure) throw error; }
    }
  }

  private createPackageDataSource(remainingMs:number):DataSource {
    const base=this.db.options;
    if(base.type!=='postgres') throw new ServiceUnavailableException('Export database unavailable');
    const checkoutMs=Math.max(1,Math.min(5000,remainingMs));
    const startupOptions=[base.extra?.options,`-c statement_timeout=${Math.max(1,remainingMs)}ms -c lock_timeout=${Math.max(1,remainingMs)}ms`]
      .filter((option):option is string=>typeof option==='string'&&option.length>0).join(' ');
    return new DataSource({...base,entities:this.db.entityMetadatas.map(meta=>meta.target),migrations:[],subscribers:[],
      poolSize:1,connectTimeoutMS:checkoutMs,extra:{...base.extra,max:1,connectionTimeoutMillis:checkoutMs,options:startupOptions},
      synchronize:false,migrationsRun:false,dropSchema:false,installExtensions:false});
  }

  private async readPackageConnection<T>(db:DataSource,action:(m:EntityManager)=>Promise<T>,control:{deadlineAt:number;signal:AbortSignal}):Promise<T> {
    const runner=db.createQueryRunner();
    let acquired=false, releaseOnAcquire=false, released=false, releasePromise:Promise<void>|undefined;
    const releaseRunner=()=>{
      if(released)return releasePromise??Promise.resolve();
      released=true; releasePromise=runner.release(); return releasePromise;
    };
    const connectPromise=runner.connect().then(async()=>{acquired=true;if(releaseOnAcquire)await releaseRunner();});
    // If the absolute deadline wins the race, a late pool checkout still has an explicit release path.
    void connectPromise.catch(()=>undefined);
    let rejectAcquisition!:(error:Error)=>void;
    const acquisitionAborted=new Promise<never>((_resolve,reject)=>{rejectAcquisition=reject;});
    const onAcquireAbort=()=>rejectAcquisition(new Error('Database connection acquisition canceled'));
    control.signal.addEventListener('abort',onAcquireAbort,{once:true});
    try { await Promise.race([connectPromise,acquisitionAborted]); }
    catch(error) {
      if(acquired)await releaseRunner();
      else {releaseOnAcquire=true;void connectPromise.then(()=>releaseRunner()).catch(()=>undefined);}
      if(Date.now()>=control.deadlineAt)throw new GatewayTimeoutException('Handover package timed out',{cause:error});
      if(control.signal.aborted)throw new ServiceUnavailableException('Handover package canceled',{cause:error});
      throw new ServiceUnavailableException('Export database checkout unavailable',{cause:error});
    } finally { control.signal.removeEventListener('abort',onAcquireAbort); }
    const rawQuery=runner.query.bind(runner);
    let committed=false, closePromise:Promise<void>|undefined, failure:unknown;
    const expired=()=>Date.now()>=control.deadlineAt;
    const postgresCode=(error:unknown)=>{
      const value=error as {code?:string;driverError?:{code?:string}};
      return value?.driverError?.code??value?.code;
    };
    const check=()=>{
      if(expired()) throw new GatewayTimeoutException('Handover package timed out');
      if(control.signal.aborted) throw new ServiceUnavailableException('Handover package canceled');
    };
    const closeTarget=()=>{
      if(closePromise) return closePromise;
      const connection=(runner as any).databaseConnection as {end?:()=>Promise<void>}|undefined;
      closePromise=connection?.end?Promise.resolve().then(()=>connection.end!()):Promise.resolve();
      void closePromise.catch(()=>undefined);
      return closePromise;
    };
    const onAbort=()=>{ void closeTarget().catch(()=>undefined); };
    control.signal.addEventListener('abort',onAbort);
    if(control.signal.aborted) onAbort();
    try {
      check();
      await runner.startTransaction('REPEATABLE READ');
      await rawQuery('SET TRANSACTION READ ONLY');
      const guardedQuery=async (sql:string, parameters?:unknown[], structured?:boolean) => {
        check();
        const remaining=Math.max(1,control.deadlineAt-Date.now());
        // Each statement gets only the remaining absolute task budget; lock waits cannot outlive it.
        await rawQuery(`SET LOCAL statement_timeout = '${remaining}ms'`);
        await rawQuery(`SET LOCAL lock_timeout = '${remaining}ms'`);
        check();
        try { return await (rawQuery as any)(sql,parameters,structured); }
        catch(error) {
          if(expired()||(!control.signal.aborted&&['57014','55P03'].includes(postgresCode(error)??'')))
            throw new GatewayTimeoutException('Handover package timed out');
          if(control.signal.aborted) throw new ServiceUnavailableException('Handover package canceled');
          throw error;
        }
      };
      (runner as any).query=guardedQuery;
      const result=await action(runner.manager);
      check();
      await runner.commitTransaction(); committed=true;
      return result;
    } catch(error) {
      if(expired()||(!control.signal.aborted&&['57014','55P03'].includes(postgresCode(error)??'')))
        failure=new GatewayTimeoutException('Handover package timed out',{cause:error});
      else if(control.signal.aborted && !(error instanceof GatewayTimeoutException))
        failure=new ServiceUnavailableException('Handover package canceled',{cause:error});
      else failure=error;
      throw failure;
    } finally {
      control.signal.removeEventListener('abort',onAbort);
      let cleanupError:unknown;
      // On abort, Client.end() destroys the local socket if a query is active.
      // Do not enqueue ROLLBACK on an uncertain connection; destroying this
      // private pool prevents reuse while server statement_timeout is the bound.
      if(closePromise) {
        try { await closePromise; } catch(error) { cleanupError=error; }
      }
      if(!closePromise&&!committed&&runner.isTransactionActive) {
        (runner as any).query=rawQuery;
        try { await runner.rollbackTransaction(); }
        catch(error) { cleanupError=error; }
      }
      if(acquired) {
        try { await releaseRunner(); }
        catch(error) { cleanupError??=error; }
      }
      // The entire private pool is destroyed by read(); a failed rollback is
      // never returned to the application's pool or another export request.
      if(cleanupError&&!failure) throw cleanupError;
    }
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
  private async acceptanceSourceIn(m:EntityManager, projectId:string, id:string):Promise<AcceptanceExportSource> {
    await this.project(m,projectId);
    const a=await m.findOneBy(ProjectAcceptance,{projectId,id});
    if(!a)throw new NotFoundException('Acceptance not found');
    if(a.status!==AcceptanceStatus.CONFIRMED)throw new ConflictException('Only confirmed acceptance can be exported');
    const s=await m.findOneBy(AcceptanceSnapshot,{projectId,acceptanceId:a.id});
    if(!s||s.schemaVersion!==1||!validSnapshot(s.content))throw new ConflictException('Acceptance snapshot unavailable or unsupported');
    const next=await m.findOneBy(ProjectAcceptance,{projectId,replacesId:a.id,status:AcceptanceStatus.CONFIRMED});
    const pins=await m.findBy(AcceptanceEvidence,{projectId,acceptanceId:a.id});
    return {snapshot:s.content as Snapshot,snapshotAt:s.createdAt,nextCode:next?.code??null,pins};
  }
  private async renderAcceptancePdf(source:AcceptanceExportSource, at:Date, checks:Array<{file:Snapshot['evidence'][number];state:string}>, signal?:AbortSignal) {
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
    }, this.limits, signal);
  }
  async acceptancePdf(projectId:string,id:string,user:AuthenticatedUser):Promise<PreparedExport> {
    manager(user); const at=new Date();
    const source=await this.read(m=>this.acceptanceSourceIn(m,projectId,id));
    const checks: Array<{ file: Snapshot['evidence'][number]; state: string }> = [];
    for(const f of source.snapshot.evidence){const pin=source.pins.find(p=>p.evidenceId===f.id);
      checks.push({file:f,state:await this.integrity(pin?.pinnedStorageKey??null,f)});}
    return this.renderAcceptancePdf(source,at,checks);
  }

  private async currentIn(m: EntityManager, projectId: string, kind: 'devices' | 'connections', at = new Date()) {
      const project = await this.project(m, projectId);
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
  }
  private current(projectId: string, kind: 'devices' | 'connections') {
    return this.read(m => this.currentIn(m, projectId, kind));
  }
  private info(project:Project,at:Date):Sheet {return {name:'Thông tin',columns:['Thuộc tính','Giá trị'],rows:[
    ['Phạm vi',`${project.code} — ${project.name}`],['Nguồn','Dữ liệu hiện tại, không phải snapshot nghiệm thu'],
    ['Thời điểm đọc UTC',at.toISOString()],['Thời điểm xuất UTC',new Date().toISOString()]]};}
  async devicesWorkbook(projectId:string,user:AuthenticatedUser,signal?:AbortSignal):Promise<PreparedExport> {
    manager(user);const release=acquireXlsxProcessSlot();
    let transferred=false;
    try {
      const file=await this.renderDevicesWorkbook(await this.current(projectId, 'devices'), signal);
      this.attachSlot(file,release); transferred=true; return file;
    } finally { if(!transferred) release(); }
  }
  private async renderDevicesWorkbook(g: Awaited<ReturnType<ExportsService['currentIn']>>, signal?:AbortSignal):Promise<PreparedExport> {
    const budget = new RowBudget(this.limits.maxRows), input = new InputBudget(this.limits.maxInputBytes); budget.add(7);
    const checked = (row: (string | number | null)[]) => { input.row(row); return row; };
    const byDevice=new Map(g.devices.map(d=>[d.id,d]));const byArea=new Map(g.areas.map(a=>[a.id,a.code]));const bySystem=new Map(g.systems.map(s=>[s.id,s.code]));
    const profiles=new Map(g.profiles.map(p=>[p.deviceId,p]));
    const rows=ordered(g.devices).map(d=>{budget.add();
      const rack=d.rackId?byDevice.get(d.rackId):null, p=profiles.get(d.id);
      return checked([d.code,d.name,d.type,d.brand,d.model,d.serialNumber,
        g.links.filter(l=>l.deviceId===d.id).map(l=>bySystem.get(l.systemId)??'').sort().join(', '),
        d.areaId?byArea.get(d.areaId)??null:null,
        d.rackId?byArea.get(rack?.areaId??'')??null:byArea.get(d.areaId??'')??null,
        d.locationNote,rack?.code??null,d.mountMode,mark(d.startU),mark(d.heightU),p?.addressMode??null,p?.ipAddress??null,p?.macAddress??null]);
    });
    const racks=ordered(g.devices.filter(d=>d.type===DeviceType.RACK)).map(r=>{budget.add();return checked([r.code,r.rackRole,byDevice.get(r.parentRackId??'')?.code??null,
      byArea.get(r.areaId??'')??null,mark(r.capacityU),g.served.filter(s=>s.rackId===r.id).map(s=>byArea.get(s.areaId)??'').sort().join(', ')]);});
    return await workbook(fileName(g.project.code,'thiet-bi',g.at)+'.xlsx',[this.info(g.project,g.at),
      {name:'Thiết bị',columns:['Mã','Tên','Loại','Hãng','Model','Serial','System','Area trực tiếp','Area hiệu lực','Ghi chú vị trí','Rack','Kiểu xếp','U bắt đầu','Chiều cao U','Chế độ IP','IP','MAC'],rows},
      {name:'Tủ',columns:['Mã','Vai trò','Tủ cha','Area đặt','Sức chứa U','Area phục vụ'],rows:racks}], this.limits, signal);
  }
  async connectionsWorkbook(projectId:string,user:AuthenticatedUser,signal?:AbortSignal):Promise<PreparedExport> {
    manager(user);const release=acquireXlsxProcessSlot();
    let transferred=false;
    try {
      const file=await this.renderConnectionsWorkbook(await this.current(projectId, 'connections'), signal);
      this.attachSlot(file,release); transferred=true; return file;
    } finally { if(!transferred) release(); }
  }

  private attachSlot(file:PreparedExport,release:()=>void):void {
    const cleanup=file.cleanup; let cleaned=false, released=false;
    const releaseOnce=()=>{ if(released)return; released=true; release(); };
    file.release=releaseOnce;
    file.cleanup=async()=>{ if(cleaned){ releaseOnce(); return; } cleaned=true; try { await cleanup(); } finally { releaseOnce(); } };
  }
  private async renderConnectionsWorkbook(g: Awaited<ReturnType<ExportsService['currentIn']>>, signal?:AbortSignal):Promise<PreparedExport> {
    const budget = new RowBudget(this.limits.maxRows), input = new InputBudget(this.limits.maxInputBytes); budget.add(8);
    const checked = (row: (string | number | null)[]) => { input.row(row); return row; };
    const device=new Map(g.devices.map(d=>[d.id,d]));const port=new Map(g.ports.map(p=>[p.id,p]));
    const byConnection=new Map(g.connections.map(c=>[c.id,c]));
    const face=(id:string,side:PortSide)=>g.endpoints.find(e=>e.portId===id&&e.side===side);
    const label=(id:string)=>{const p=port.get(id);return p?`${device.get(p.deviceId)?.code??'?'} / ${p.code}`:'Cổng không tồn tại';};
    const sides=(d:ProjectDevice):PortSide[]=>[DeviceType.NETWORK_OUTLET,DeviceType.PATCH_PANEL].includes(d.type)?[PortSide.FRONT,PortSide.REAR]:[DeviceType.SWITCH,DeviceType.CAMERA,DeviceType.AP].includes(d.type)?[PortSide.SINGLE]:[];
    const ports=ordered(g.ports).flatMap(p=>sides(device.get(p.deviceId)!).map(side=>{budget.add();return checked([device.get(p.deviceId)!.code,p.code,p.description,side,face(p.id,side)?.connectionId??'Trống',mark(p.accessVlanId),mark(p.poeEnabled)]);}));
    const wires=g.connections.sort((a,b)=>a.id.localeCompare(b.id)).map(c=>{budget.add();const a=g.endpoints.find(e=>e.connectionId===c.id&&e.end===EndpointEnd.A),b=g.endpoints.find(e=>e.connectionId===c.id&&e.end===EndpointEnd.B);
      return checked([c.label,c.kind,c.version,a?label(a.portId):'Thiếu A',a?.side??null,b?label(b.portId):'Thiếu B',b?.side??null]);});
    const traces:(string|number|null)[][]=[];
    for(const d of ordered(g.devices.filter(d=>[DeviceType.NETWORK_OUTLET,DeviceType.CAMERA,DeviceType.AP].includes(d.type)))){
      const sourcePorts=ordered(g.ports.filter(p=>p.deviceId===d.id));
      if(!sourcePorts.length){budget.add();traces.push(checked([d.code,'Không có cổng','', 'Thiếu cổng',null,null,null,null]));}
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
        traces.push(checked([d.code,first.code,segments.join(' | '),end?'Đủ khai báo tới switch':`Thiếu: ${missing}`,panels.join(', '),racks.join(', '),end?label(end.id):null,end?`${mark(end.accessVlanId)} / ${mark(end.poeEnabled)}`:null]));
      }
    }
    return await workbook(fileName(g.project.code,'dau-noi',g.at)+'.xlsx',[this.info(g.project,g.at),
      {name:'Cổng',columns:['Thiết bị','Mã cổng','Mô tả','Mặt','Connection ID/Trạng thái','VLAN','PoE'],rows:ports},
      {name:'Dây',columns:['Nhãn','Loại','Version','Đầu A','Mặt A','Đầu B','Mặt B'],rows:wires},
      {name:'Tra cứu',columns:['Thiết bị nguồn','Cổng nguồn','Các đoạn dây','Độ đầy đủ','Panel/port','Rack qua đường','Switch/port','VLAN / PoE'],rows:traces}], this.limits, signal);
  }

  private async packageTempDirectory():Promise<string> {
    try {
      const base=await realpath(tmpdir()), repo=await realpath(resolve(__dirname,'../../..'));
      const rel=relative(repo,base);
      if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel))) throw new ServiceUnavailableException('Unsafe temporary storage');
      return await mkdtemp(join(base,'elv-handover-stage-'));
    } catch(error) { if(error instanceof ServiceUnavailableException) throw error; throw new ServiceUnavailableException('Temporary storage unavailable'); }
  }

  private async stagePinnedEvidence(source:AcceptanceExportSource, file:Snapshot['evidence'][number], index:number, dir:string,
    signal:AbortSignal, aggregate:{used:number;limit:number}) {
    const id=file.id.toLowerCase();
    const pin=source.pins.find(p=>p.evidenceId.toLowerCase()===id);
    const key=pin?.pinnedStorageKey;
    const extension=evidenceExtension[file.mimeType];
    const uploader=source.snapshot.actors.find(a=>a.id.toLowerCase()===String((file as any).uploadedById).toLowerCase());
    const createdAt=new Date((file as any).createdAt);
    if(!key||!/^[a-f0-9-]{36}$/i.test(key)||!extension||!uploader||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<1||file.sizeBytes>10*1024*1024
      ||!Number.isFinite(createdAt.getTime())||!(/^[a-f0-9]{64}$/i.test(file.sha256)))
      throw new ConflictException('Pinned evidence snapshot is incomplete');
    const root=await this.storage.root();
    try { const info=await stat(join(root,'files',key)); if(!info.isFile()) throw new ConflictException('Pinned evidence file is unavailable'); }
    catch(error) {
      if(error instanceof ConflictException) throw error;
      if((error as NodeJS.ErrnoException).code==='ENOENT') throw new ConflictException('Pinned evidence file is missing');
      throw new ServiceUnavailableException('Evidence storage unavailable');
    }
    const stagedPath=join(dir,`evidence-${String(index+1).padStart(3,'0')}.${extension}`);
    let handle;
    try { handle=await this.storage.content(key); }
    catch { throw new ServiceUnavailableException('Evidence storage unavailable'); }
    const hash=createHash('sha256'); let sizeBytes=0;
    const counted=new Transform({ transform(chunk:Buffer,_encoding,callback) {
      if(signal.aborted) return callback(new Error('canceled'));
      sizeBytes+=chunk.length; aggregate.used+=chunk.length;
      if(sizeBytes>file.sizeBytes) return callback(new ConflictException('Pinned evidence size differs from snapshot'));
      if(aggregate.used>aggregate.limit) return callback(new PayloadTooLargeException('Handover package exceeds uncompressed byte limit'));
      hash.update(chunk); callback(null,chunk);
    }});
    const input=handle.createReadStream({autoClose:false});
    const output=createWriteStream(stagedPath,{flags:'wx',mode:0o600});
    try {
      await pipeline(input,counted,output,{signal});
    } catch(error) {
      input.destroy(); counted.destroy(); output.destroy();
      await Promise.all([input.closed?Promise.resolve():new Promise<void>(resolve=>input.once('close',()=>resolve())),
        output.closed?Promise.resolve():new Promise<void>(resolve=>output.once('close',()=>resolve()))]);
      await rm(stagedPath,{force:true}).catch(()=>undefined);
      if(signal.aborted) throw new ServiceUnavailableException('Handover package canceled');
      if(error instanceof ConflictException||error instanceof PayloadTooLargeException) throw error;
      throw new ServiceUnavailableException('Cannot read pinned evidence');
    } finally { await handle.close().catch(()=>undefined); }
    if(sizeBytes!==file.sizeBytes||hash.digest('hex')!==file.sha256.toLowerCase()) {
      await rm(stagedPath,{force:true});
      throw new ConflictException('Pinned evidence checksum differs from snapshot');
    }
    return { path:stagedPath, name:`evidence/${String(index+1).padStart(3,'0')}.${extension}`,
      mimeType:file.mimeType,sizeBytes,sha256:file.sha256.toLowerCase(),originalName:file.originalName,caption:file.caption,
      uploader:uploader.email,uploadedAt:createdAt.toISOString() };
  }

  async handoverPackage(projectId:string,id:string,user:AuthenticatedUser,requestSignal?:AbortSignal):Promise<PreparedExport> {
    manager(user);
    const deadlineAt=Date.now()+this.limits.handoverTimeoutMs;
    const release=acquireXlsxProcessSlot();
    const controller=new AbortController();
    const onRequestAbort=()=>controller.abort();
    requestSignal?.addEventListener('abort',onRequestAbort,{once:true});
    if(requestSignal?.aborted) onRequestAbort();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.limits.handoverTimeoutMs);
    const signal=controller.signal;
    let stageDir:string|undefined;
    const prepared:PreparedExport[]=[];
    let finalZip:PreparedExport|undefined;
    let slotTransferred=false;
    const check=()=>{ if(timedOut) throw new GatewayTimeoutException('Handover package timed out'); if(signal.aborted) throw new ServiceUnavailableException('Handover package canceled'); };
    try {
      check();
      const source=await this.read(async m=>{
        const [{ startedAt }]=await m.query('SELECT transaction_timestamp() AS "startedAt"');
        const acceptance=await this.acceptanceSourceIn(m,projectId,id);
        const currentAt=new Date(startedAt);
        const current={ devices:await this.currentIn(m,projectId,'devices',currentAt), connections:await this.currentIn(m,projectId,'connections',currentAt) };
        return { acceptance,current,currentAt };
      },{deadlineAt,signal});
      check();
      const evidence=source.acceptance.snapshot.evidence;
      if(evidence.length>this.limits.maxPackageEvidence) throw new PayloadTooLargeException('Handover package has too many evidence files');
      const expectedEvidenceBytes=evidence.reduce((total,file)=>total+file.sizeBytes,0);
      if(!Number.isSafeInteger(expectedEvidenceBytes)||expectedEvidenceBytes>this.limits.maxPackageBytes)
        throw new PayloadTooLargeException('Handover package exceeds uncompressed byte limit');
      stageDir=await this.packageTempDirectory();
      const checks=evidence.map(file=>({file,state:'KHỚP SHA-256'}));
      prepared.push(await this.renderAcceptancePdf(source.acceptance,source.currentAt,checks,signal));
      check();
      // This package owns the process-wide XLSX slot; render-only calls avoid reacquiring it.
      prepared.push(await this.renderDevicesWorkbook(source.current.devices,signal));
      check();
      prepared.push(await this.renderConnectionsWorkbook(source.current.connections,signal));
      check();
      const baseEntries=[
        {path:prepared[0].path,name:'acceptance/acceptance.pdf',kind:'acceptance-snapshot-pdf',source:'acceptance-snapshot'},
        {path:prepared[1].path,name:'current/devices.xlsx',kind:'current-project-devices',source:'current-project-read'},
        {path:prepared[2].path,name:'current/connections.xlsx',kind:'current-project-connections',source:'current-project-read'},
      ];
      const fileRecords=[]; let artifactBytes=0;
      for(const entry of baseEntries) {
        const digest=await digestFile(entry.path); artifactBytes+=digest.sizeBytes;
        fileRecords.push({path:entry.name,kind:entry.kind,source:entry.source,sizeBytes:digest.sizeBytes,sha256:digest.sha256});
      }
      const uploaderById=new Map(source.acceptance.snapshot.actors.map(actor=>[actor.id.toLowerCase(),actor.email]));
      const expectedFiles=evidence.map((file,index)=>{
        const uploader=uploaderById.get(file.uploadedById.toLowerCase());
        const extension=evidenceExtension[file.mimeType];
        if(!uploader||!extension||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<1||!Number.isFinite(new Date(file.createdAt).getTime()))
          throw new ConflictException('Pinned evidence snapshot is incomplete');
        return {path:`evidence/${String(index+1).padStart(3,'0')}.${extension}`,kind:'pinned-evidence',source:'acceptance-snapshot',
          sizeBytes:file.sizeBytes,sha256:file.sha256.toLowerCase(),originalName:file.originalName,caption:file.caption,uploader,
          mimeType:file.mimeType,uploadedAt:new Date(file.createdAt).toISOString()};
      });
      fileRecords.push(...expectedFiles);
      const generatedAt=new Date();
      const manifest={schemaVersion:1,generatedAt:generatedAt.toISOString(),project:{code:source.acceptance.snapshot.project.code,name:source.acceptance.snapshot.project.name},
        acceptance:{code:source.acceptance.snapshot.acceptance.code,title:source.acceptance.snapshot.acceptance.title,status:'CONFIRMED',
          snapshotAt:source.acceptance.snapshotAt.toISOString(),replacementStatusAtExport:source.acceptance.nextCode?'REPLACED':'NOT_REPLACED',
          replacementStatusAt:source.currentAt.toISOString(),replacedByCode:source.acceptance.nextCode},
        currentData:{snapshotAt:source.currentAt.toISOString(),source:'READ ONLY REPEATABLE READ'},files:fileRecords};
      const manifestBytes=Buffer.byteLength(JSON.stringify(manifest,null,2)+'\n','utf8');
      const stagingAllowance=this.limits.maxPackageBytes-artifactBytes-manifestBytes;
      if(stagingAllowance<0||expectedEvidenceBytes>stagingAllowance)
        throw new PayloadTooLargeException('Handover package exceeds uncompressed byte limit');
      const aggregate={used:0,limit:stagingAllowance};
      const stagedEvidence=[];
      for(let index=0;index<evidence.length;index++) {
        check(); stagedEvidence.push(await this.stagePinnedEvidence(source.acceptance,evidence[index],index,stageDir,signal,aggregate));
      }
      check();
      const uncompressedBytes=artifactBytes+aggregate.used+manifestBytes;
      if(uncompressedBytes>this.limits.maxPackageBytes) throw new PayloadTooLargeException('Handover package exceeds uncompressed byte limit');
      finalZip=await zipExport(fileName(source.acceptance.snapshot.acceptance.code,'ban-giao',generatedAt)+'.zip',manifest,
        [...baseEntries,...stagedEvidence.map(file=>({path:file.path,name:file.name}))],this.limits,signal);
      check();
      finalZip.deadlineAt=deadlineAt;
      this.attachSlot(finalZip,release);
      // The controller owns this lease until the response finishes or is aborted.
      slotTransferred=true;
      return finalZip;
    } catch(error) {
      if(finalZip) await finalZip.cleanup();
      if(timedOut) throw new GatewayTimeoutException('Handover package timed out');
      throw error;
    } finally {
      clearTimeout(timer); requestSignal?.removeEventListener('abort',onRequestAbort);
      for(const file of prepared) await file.cleanup().catch(()=>undefined);
      if(stageDir) await rm(stageDir,{recursive:true,force:true}).catch(()=>undefined);
      if(!slotTransferred) release();
    }
  }
}
