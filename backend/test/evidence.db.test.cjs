// Every write and migration down/up is confined to a disposable DB/storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { withDisposableHttpDb, cleanupTestRunner } = require('./disposable-http-db.cjs');
const { EvidenceService } = require('../dist/evidence/evidence.service');
const { EvidenceStorage } = require('../dist/evidence/evidence.storage');
const { EvidenceAttachment } = require('../dist/evidence/evidence.entity');
const { reconcileEvidence } = require('../dist/database/evidence-reconcile');
const { Project } = require('../dist/projects/project.entity');
const { ProjectSystem } = require('../dist/projects/project-system.entity');
const { ProjectArea } = require('../dist/projects/project-area.entity');
const { ProjectTask } = require('../dist/tasks/project-task.entity');
const { TasksService } = require('../dist/tasks/tasks.service');
const { User } = require('../dist/users/user.entity');
const { InspectionsService } = require('../dist/inspections/inspections.service');
const { seedTemplates } = require('../dist/inspections/seed-templates');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const rejects = (promise, status) => assert.rejects(promise, e => e.getStatus?.() === status);

// Hold the first transaction after the real service writes; release only once
// pg_blocking_pids proves the second independent connection is waiting.
async function orderedRace(db, firstAction, secondAction, storage) {
  const a = db.createQueryRunner(), b = db.createQueryRunner();
  let release, ready, failed;
  const gate = new Promise(r => { release = r; });
  const prepared = new Promise((r,j) => { ready = r; failed = j; });
  const settle = p => p.then(value => ({ value }), error => ({ error }));
  let first, second, failure;
  const services = (runner, hold) => {
    const wrapped = { getRepository: e => db.getRepository(e), createQueryRunner: () => new Proxy(runner, { get(target,key) {
      if(key==='release') return async()=>{}; // The race owns both connections.
      if(key==='startTransaction') return async()=>{await target.startTransaction();await target.query("SET LOCAL lock_timeout = '8s'");await target.query("SET LOCAL statement_timeout = '12s'");};
      if(key==='commitTransaction') return async()=>{if(hold){ready();await gate;}await target.commitTransaction();};
      if(key==='rollbackTransaction') return async()=>{if(hold)failed(new Error('First transaction rolled back'));await target.rollbackTransaction();};
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }}), transaction: async work => {
      try {
        await runner.startTransaction(); await runner.query("SET LOCAL lock_timeout = '8s'");
        await runner.query("SET LOCAL statement_timeout = '12s'");
        const value = await work(runner.manager);
        if (hold) { ready(); await gate; }
        await runner.commitTransaction(); return value;
      } catch (e) {
        if (hold) failed(e);
        try { if (runner.isTransactionActive) await runner.rollbackTransaction(); }
        catch (cleanup) { throw new AggregateError([e, cleanup], 'Race transaction rollback failed', { cause: e }); }
        throw e;
      }
    }};
    return { evidence: new EvidenceService(wrapped, storage), inspections: new InspectionsService(wrapped),
      // Task operations use a conditional UPDATE; an outer real transaction
      // lets the test hold that same row lock before COMMIT.
      task: async action => wrapped.transaction(m => action(new TasksService(m.getRepository(ProjectTask), m.getRepository(Project), m.getRepository(ProjectSystem), m.getRepository(ProjectArea), m.getRepository(User)))) };
  };
  try {
    await a.connect(); await b.connect();
    const ap = (await a.query('SELECT pg_backend_pid() pid'))[0].pid;
    const bp = (await b.query('SELECT pg_backend_pid() pid'))[0].pid;
    first = settle(firstAction(services(a,true))); await prepared;
    second = settle(secondAction(services(b,false)));
    let blocked = false; const end = Date.now()+6000;
    do { blocked = (await db.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) blocked',[ap,bp]))[0].blocked;
      if (!blocked) await new Promise(r=>setImmediate(r));
    } while (!blocked && Date.now()<end);
    assert.equal(blocked,true,'second connection must actually wait on PostgreSQL lock');
    release(); return [await first, await second];
  } catch (error) { failure = error; throw error; }
  finally {
    release(); if(first) await first; if(second) await second;
    const errors = [];
    for (const runner of [a, b]) {
      try { if (runner.isTransactionActive) await runner.rollbackTransaction(); } catch (error) { errors.push(error); }
      try { await runner.release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, 'Evidence race cleanup failed', { cause: failure ?? errors[0] });
  }
}

test('partial TypeORM bootstrap failure closes real PostgreSQL pool/session and drops its owned DB', { timeout: 30000 }, async () => {
  // Real pool/SQL; only the bootstrap getVersion failure is injected. No global patch.
  const Module = require('node:module');
  const { Client } = require('pg');
  const { dataSource } = require('../dist/database/data-source.js');
  const original = new Error('Injected bootstrap failure before isInitialized');
  let pool, name, injected = false;
  class BootstrapFailureSource extends DataSource {
    constructor(options) {
      super(options);
      name = options.database;
      const create = this.driver.createQueryRunner.bind(this.driver);
      this.driver.createQueryRunner = (...args) => {
        const runner = create(...args);
        runner.getVersion = async () => {
          pool = this.driver.master;
          assert.equal(this.isInitialized, false);
          const [identity] = await runner.query(`SELECT current_database() AS name,
            current_user AS actor, pg_get_userbyid(datdba) AS owner,
            shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
          assert.equal(identity.name, name);
          assert.equal(identity.actor, identity.owner);
          assert.match(identity.marker, /^elv-disposable:/);
          assert.ok(pool.totalCount > 0, 'a real PostgreSQL session exists before the fault');
          injected = true;
          throw original;
        };
        return runner;
      };
    }
  }
  const filename = path.join(__dirname, 'disposable-http-db.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = module.paths;
  loaded.require = key => key === 'typeorm' ? { DataSource: BootstrapFailureSource } : require(key);
  loaded._compile(require('node:fs').readFileSync(filename, 'utf8'), filename);
  await assert.rejects(loaded.exports.withDisposableHttpDb('bootstrap', async () => assert.fail('no migration/fixture callback')), e => e === original);
  assert.equal(injected, true);
  assert.equal(pool.ended, true);
  assert.equal(pool.totalCount, 0);
  const options = dataSource.options;
  const observer = new Client({ host: options.host, port: options.port, user: options.username,
    password: options.password, database: options.database, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await observer.connect();
    assert.equal((await observer.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0);
    assert.equal((await observer.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1', [name])).rowCount, 0);
  } finally { await observer.end(); }
});

test('Evidence PostgreSQL/HTTP contract', { timeout: 180000 }, async t => {
  await withDisposableHttpDb('evidence', async (db, verify) => {
  const name = db.options.database;
  const previous = { DB_NAME:process.env.DB_NAME, JWT_SECRET:process.env.JWT_SECRET, EVIDENCE_STORAGE_DIR:process.env.EVIDENCE_STORAGE_DIR };
  let root, app, failure;
  try {
    await verify();
    root = await fs.mkdtemp(path.join(os.tmpdir(),'elv-evidence-'));
    process.env.EVIDENCE_STORAGE_DIR=root;
    const users=db.getRepository(User);
    const makeUser=(email,role)=>users.save({email,role,isActive:true,passwordHash:randomBytes(32).toString('hex')});
    const manager=await makeUser('manager@evidence.invalid','MANAGER');
    const tech=await makeUser('tech@evidence.invalid','TECHNICIAN');
    const other=await makeUser('other@evidence.invalid','TECHNICIAN');
    const p=await db.getRepository(Project).save({code:'EV-A',name:'Evidence A'});
    const p2=await db.getRepository(Project).save({code:'EV-B',name:'Evidence B'});
    const system=await db.getRepository(ProjectSystem).save({projectId:p.id,code:'LAN',name:'LAN',category:'LAN'});
    const storage=new EvidenceStorage(), svc=new EvidenceService(db,storage), inspections=new InspectionsService(db);
    const tasks=new TasksService(db.getRepository(ProjectTask),db.getRepository(Project),db.getRepository(ProjectSystem),db.getRepository(ProjectArea),users);
    let serial=0;
    const task=()=>tasks.createTask(p.id,{code:'EV-'+(++serial),title:'Evidence task',systemId:system.id,assigneeId:tech.id},manager);
    const staged=async (caption=null) => { const key=randomUUID(), file=path.join(root,'tmp',key); await storage.root(); await fs.writeFile(file,png);
      return {key,path:file,originalName:'evidence.png',mimeType:'image/png',sizeBytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),caption}; };
    const upload=async (target,user=tech,key=randomUUID(),caption=null,service=svc)=>service.upload(p.id,target,user,key,await staged(caption));
    await seedTemplates(db); const template=(await inspections.listTemplates('LAN',manager))[0];
    const sheet=()=>inspections.createInspection(p.id,{code:'S-'+(++serial),title:'Evidence sheet',systemId:system.id,templateId:template.id},manager);
    const fault=async()=>{ const s=await sheet(); const i=await inspections.putResult(p.id,s.id,s.items[0].id,{expectedVersion:1,result:'FAIL',issue:{description:'Fault',assigneeId:tech.id}},manager); return i.activeIssue; };
    let a,e,issue;

    await t.test('failed rollback discards the real lock holder before awaiting retry; next request uses a clean session', {timeout:25000}, async () => {
      const holder=db.createQueryRunner(), waiter=db.createQueryRunner();
      const rollback=holder.rollbackTransaction;
      const original=new assert.AssertionError({message:'Injected assertion while holding a row lock'});
      const rollbackFailure=new Error('Injected rollback failure before SQL');
      let pending,failure,heldClient,holderPid,waiterPid;
      const acquired=[],removed=[];
      const onAcquire=client=>acquired.push(client);
      const onRemove=client=>removed.push(client);
      try {
        await holder.connect(); await waiter.connect();
        await verify(holder); await verify(waiter);
        await waiter.query("SET statement_timeout='8s'");
        await waiter.query("SET lock_timeout='6s'");
        holderPid=(await holder.query('SELECT pg_backend_pid() pid'))[0].pid;
        waiterPid=(await waiter.query('SELECT pg_backend_pid() pid'))[0].pid;
        heldClient=await holder.connect();
        await holder.startTransaction();
        await holder.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[p.id]);
        pending=waiter.query('UPDATE projects SET name=name WHERE id=$1 RETURNING id',[p.id],true)
          .then(value=>({value}),error=>({error}));
        let blocked=false; const end=Date.now()+4000;
        do {
          blocked=(await db.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked',[holderPid,waiterPid]))[0].blocked;
          if(!blocked) await new Promise(resolve=>setImmediate(resolve));
        } while(!blocked && Date.now()<end);
        assert.equal(blocked,true,'the second independent session must be waiting for this row lock');
        db.driver.master.on('remove',onRemove);
        holder.rollbackTransaction=async()=>{throw rollbackFailure;};
        const release=holder.release.bind(holder);
        holder.release=async()=>{
          assert.equal(heldClient._ended,true,'client end acknowledged before release');
          assert.equal(heldClient.connection.stream.closed,true,'socket closed before release');
          return release();
        };
        await assert.rejects(cleanupTestRunner(holder,original,pending), error =>
          error instanceof AggregateError && error.cause===original && error.errors[0]===original && error.errors.includes(rollbackFailure));
        assert.equal(holder.isReleased,true);
        assert.ok(removed.includes(heldClient),'pg-pool acknowledged removal of the discarded client');
        assert.equal((await db.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1',[holderPid])).length,0);
        const result=await pending; assert.ifError(result.error);
        assert.equal(result.value.records[0].id,p.id,'waiter completed after the lock holder disconnected');
        assert.equal(heldClient.getTransactionStatus(),'T','failed rollback did not run SQL; disconnection released the lock');
        assert.equal(db.driver.connectedQueryRunners.includes(holder),false);
        db.driver.master.on('acquire',onAcquire);
        assert.equal((await db.query('SELECT 1 AS clean'))[0].clean,1);
        assert.ok(acquired.length>0);
        assert.ok(acquired.every(client=>client!==heldClient),'pool must never reuse the discarded client');
        assert.ok(acquired.every(client=>client.getTransactionStatus()==='I'),'the next request is not inside the old transaction');
      } catch(error) { failure=error; throw error; }
      finally {
        holder.rollbackTransaction=rollback;
        db.driver.master.off('acquire',onAcquire);
        db.driver.master.off('remove',onRemove);
        const errors=[];
        try { if(!holder.isReleased) await cleanupTestRunner(holder,failure,pending); } catch(error) { errors.push(error); }
        try { await cleanupTestRunner(waiter); } catch(error) { errors.push(error); }
        if(errors.length) throw new AggregateError(failure?[failure,...errors]:errors,'Rollback regression cleanup failed',{cause:failure??errors[0]});
      }
    });

    await t.test('idempotency normalizes caption, persists one file, never changes Task; conflicting content is 409',async()=>{
      a=await task(); const before=await tasks.getTask(p.id,a.id,manager); const key=randomUUID();
      e=await upload({taskId:a.id},tech,key,'  note  ');
      const retry=await upload({taskId:a.id},tech,key,'note'); assert.equal(retry.id,e.id);
      await rejects(upload({taskId:a.id},tech,key,'different'),409);
      assert.deepEqual(await tasks.getTask(p.id,a.id,manager),before);
      assert.equal((await fs.readdir(path.join(root,'tmp'))).length,0);
      assert.equal((await fs.readdir(path.join(root,'files'))).length,1);
      assert.equal(JSON.stringify(e).includes('storageKey'),false); assert.equal(JSON.stringify(e).includes('passwordHash'),false);
    });
    await t.test('ownership and reassignment revoke old user; cross-project and Item TECHNICIAN forbidden',async()=>{
      await rejects(svc.list(p.id,{taskId:a.id},other),404);
      await rejects(svc.content(p2.id,e.id,manager,false),404);
      await tasks.updateTask(p.id,a.id,{assigneeId:other.id},manager);
      await rejects(svc.content(p.id,e.id,tech,false),404);
      await rejects(upload({taskId:a.id},tech),404);
      assert.equal((await svc.list(p.id,{taskId:a.id},other)).length,1);
      await rejects(svc.remove(p.id,e.id,{expectedVersion:1,reason:'Remove'},other),403);
      const s=await sheet(); await rejects(svc.list(p.id,{inspectionItemId:s.items[0].id},tech),403);
      await rejects(upload({inspectionItemId:s.items[0].id},tech),403);
    });
    await t.test('PATCH/null/version and soft delete keep disk; deleted retry/content/preview return 404',async()=>{
      await rejects(svc.update(p.id,e.id,{expectedVersion:1},manager),400);
      const updated=await svc.update(p.id,e.id,{expectedVersion:1,caption:null},manager); assert.equal(updated.caption,null);
      await rejects(svc.remove(p.id,e.id,{expectedVersion:1,reason:'Remove'},manager),409);
      await svc.remove(p.id,e.id,{expectedVersion:2,reason:'Remove'},manager);
      await rejects(svc.content(p.id,e.id,other,true),404); await rejects(svc.content(p.id,e.id,manager,false),404);
      assert.equal((await fs.readdir(path.join(root,'files'))).length,1);
    });
    await t.test('concurrent quota: one of requests 20/21 wins, no orphan/duplicate record',async()=>{
      const q=await task(); for(let i=0;i<19;i++) await upload({taskId:q.id});
      const [first,second]=await orderedRace(db,s=>upload({taskId:q.id},tech,randomUUID(),null,s.evidence),s=>upload({taskId:q.id},tech,randomUUID(),null,s.evidence),storage);
      assert.ok(first.value); assert.equal(second.error.getStatus(),409);
      assert.equal((await svc.list(p.id,{taskId:q.id},manager)).length,20);
    });
    await t.test('concurrent same idempotency key returns same attachment, 1 row',async()=>{
      const q=await task(), key=randomUUID();
      const results=await orderedRace(db,s=>upload({taskId:q.id},tech,key,'note',s.evidence),s=>upload({taskId:q.id},tech,key,' note ',s.evidence),storage);
      assert.equal(results[0].value.id,results[1].value.id); assert.equal((await svc.list(p.id,{taskId:q.id},manager)).length,1);
      await tasks.startTask(p.id,q.id,tech); await tasks.submitTask(p.id,q.id,'Done',tech);
      assert.equal((await upload({taskId:q.id},tech,key,'note')).id,results[0].value.id);
      await rejects(upload({taskId:q.id}),409);
      await tasks.approveTask(p.id,q.id,manager); await rejects(svc.update(p.id,results[0].value.id,{expectedVersion:1,caption:'new'},manager),409);
    });
    await t.test('upload vs submit both lock orders: first upload included, first submit rejects later upload',async()=>{
      for(const uploadFirst of [true,false]) {
        const q=await task(); await tasks.startTask(p.id,q.id,tech);
        const up=s=>upload({taskId:q.id},tech,randomUUID(),null,s.evidence);
        const submit=s=>s.task(svc=>svc.submitTask(p.id,q.id,'Done',tech));
        const [first,second]=await orderedRace(db,uploadFirst?up:submit,uploadFirst?submit:up,storage);
        assert.ok(first.value); if(uploadFirst) assert.equal(second.value.status,'SUBMITTED'); else assert.equal(second.error.getStatus(),409);
        assert.equal((await tasks.getTask(p.id,q.id,manager)).status,'SUBMITTED');
        assert.equal((await svc.list(p.id,{taskId:q.id},manager)).length,uploadFirst?1:0);
      }
    });
    await t.test('Issue upload vs resolve both orders; RESOLVED/CLOSED immutable, historical content still readable',async()=>{
      for(const uploadFirst of [true,false]) {
        const f=await fault(); const started=await inspections.startIssue(p.id,f.id,{expectedVersion:1},tech);
        const up=s=>upload({issueId:f.id},tech,randomUUID(),null,s.evidence);
        const resolve=s=>s.inspections.resolveIssue(p.id,f.id,{expectedVersion:started.version,resolutionNote:'Fixed'},tech);
        const [first,second]=await orderedRace(db,uploadFirst?up:resolve,uploadFirst?resolve:up,storage);
        assert.ok(first.value); if(uploadFirst) assert.equal(second.value.status,'RESOLVED'); else assert.equal(second.error.getStatus(),409);
        assert.equal((await inspections.getIssue(p.id,f.id,tech)).status,'RESOLVED');
      }
      issue=await fault(); e=await upload({issueId:issue.id});
      const started=await inspections.startIssue(p.id,issue.id,{expectedVersion:1},tech);
      issue=await inspections.resolveIssue(p.id,issue.id,{expectedVersion:started.version,resolutionNote:'Fixed'},tech);
      await rejects(svc.remove(p.id,e.id,{expectedVersion:1,reason:'Remove'},manager),409);
      const closed=await inspections.recheckIssue(p.id,issue.id,{expectedVersion:issue.version,expectedItemVersion:issue.item.version,result:'PASS',note:'Verified'},manager);
      assert.equal(closed.status,'CLOSED'); await rejects(upload({issueId:issue.id},manager),409);
      const content=await svc.content(p.id,e.id,tech,true); await content.handle.close();
    });
    await t.test('Item upload vs recheck both orders, no lost Item/Issue version',async()=>{
      for(const uploadFirst of [true,false]) {
        const f=await fault(); const started=await inspections.startIssue(p.id,f.id,{expectedVersion:1},tech);
        const resolved=await inspections.resolveIssue(p.id,f.id,{expectedVersion:started.version,resolutionNote:'Fixed'},tech);
        const up=s=>upload({inspectionItemId:resolved.item.id},manager,randomUUID(),null,s.evidence);
        const recheck=s=>s.inspections.recheckIssue(p.id,f.id,{expectedVersion:resolved.version,expectedItemVersion:resolved.item.version,result:'PASS',note:'Verified'},manager);
        const [first,second]=await orderedRace(db,uploadFirst?up:recheck,uploadFirst?recheck:up,storage);
        assert.ok(first.value); if(uploadFirst) assert.equal(second.value.status,'CLOSED'); else assert.equal(second.error.getStatus(),409);
        const end=await inspections.getIssue(p.id,f.id,manager); assert.equal(end.status,'CLOSED'); assert.equal(end.item.result,'PASS');
        assert.equal(end.version,resolved.version+1); assert.equal(end.item.version,resolved.item.version+1);
      }
    });
    await t.test('DB/FK failure after file promotion cleans file; filesystem failure leaves no metadata',async()=>{
      const q=await task(); const before=await fs.readdir(path.join(root,'files'));
      await rejects(upload({taskId:q.id},{...tech,id:randomUUID(),role:'MANAGER'}),409);
      assert.deepEqual(await fs.readdir(path.join(root,'files')),before);
      const failing=new EvidenceService(db,{...storage,promote:async()=>{throw new (require('@nestjs/common').ServiceUnavailableException)('Storage failed');},discard:p=>storage.discard(p)});
      await rejects(upload({taskId:q.id},tech,randomUUID(),null,failing),503);
      assert.deepEqual(await svc.list(p.id,{taskId:q.id},manager),[]);
      const runner=db.createQueryRunner(); let failure;
      try {
        await runner.connect(); await runner.startTransaction();
        await assert.rejects(runner.query(`INSERT INTO evidence_attachments(project_id,task_id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by_id,idempotency_key,fingerprint)
          VALUES($1,$2,$3,'a.png','image/png',1,$4,$5,$6,$4)`,[p2.id,q.id,randomUUID(),'a'.repeat(64),tech.id,randomUUID()]),e=>e.driverError.code==='23503');
      } catch (error) { failure=error; throw error; }
      finally { await cleanupTestRunner(runner,failure); }
    });
    await t.test('read-only reconciliation never deletes metadata files, tmp/in-flight or orphan candidates',async()=>{
      const extra=randomUUID(), active=randomUUID(); await fs.writeFile(path.join(root,'files',extra),png); await fs.writeFile(path.join(root,'tmp',active),png);
      const report=await reconcileEvidence(db,storage); assert.equal(report.deleted,0); assert.ok(report.unreferencedOrInFlight.includes(extra)); assert.equal(report.temporaryOrInFlightCount,1);
      assert.ok((await fs.readdir(path.join(root,'files'))).includes(extra)); assert.ok((await fs.readdir(path.join(root,'tmp'))).includes(active));
      await fs.unlink(path.join(root,'files',extra)); await fs.unlink(path.join(root,'tmp',active));
    });
    await t.test('lost COMMIT acknowledgement retains the referenced file; retry returns committed record',async()=>{
      const q=await task(), key=randomUUID();
      const runner=db.createQueryRunner();
      const ambiguous=new EvidenceService({createQueryRunner:()=>new Proxy(runner,{get(target,key){
        if(key==='commitTransaction')return async()=>{await target.commitTransaction();throw new Error('Simulated lost acknowledgement');};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }})},storage);
      await assert.rejects(upload({taskId:q.id},tech,key,null,ambiguous),/Simulated lost acknowledgement/);
      const stored=await db.getRepository(EvidenceAttachment).findOneByOrFail({taskId:q.id});
      const handle=await storage.content(stored.storageKey);await handle.close();
      assert.equal((await upload({taskId:q.id},tech,key)).id,stored.id);
    });
    await t.test('unknown COMMIT while transaction is still pending retains file; blocked retry returns one committed row', {timeout:15000},async()=>{
      const q=await task(),key=randomUUID(),file=await staged();
      const runner=db.createQueryRunner();let retry,failure;
      const ambiguous=new EvidenceService({createQueryRunner:()=>new Proxy(runner,{get(target,key){
        if(key==='commitTransaction')return async()=>{throw new Error('Injected unknown COMMIT outcome');};
        if(key==='rollbackTransaction')return async()=>{throw new Error('Injected unavailable rollback acknowledgement');};
        if(key==='release')return async()=>{};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }})},storage);
      try {
        await assert.rejects(ambiguous.upload(p.id,{taskId:q.id},tech,key,file),/unknown COMMIT/);
        assert.equal(runner.isTransactionActive,true);
        assert.equal(await db.getRepository(EvidenceAttachment).countBy({taskId:q.id}),0,'observer cannot see uncommitted metadata');
        const stored=await runner.manager.findOneByOrFail(EvidenceAttachment,{taskId:q.id});
        const handle=await storage.content(file.key);await handle.close();
        const pid=(await runner.query('SELECT pg_backend_pid() pid'))[0].pid;
        retry=upload({taskId:q.id},tech,key).then(value=>({value}),error=>({error}));
        let blocked=false;const end=Date.now()+6000;
        do {blocked=(await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::int = ANY(pg_blocking_pids(pid))) blocked',[pid]))[0].blocked;
          if(!blocked)await new Promise(r=>setImmediate(r));
        }while(!blocked&&Date.now()<end);
        assert.equal(blocked,true,'retry waits for the original target lock, not an observer existsBy result');
        await runner.commitTransaction();
        const result=await retry;assert.ifError(result.error);assert.equal(result.value.id,stored.id);
        assert.equal(await db.getRepository(EvidenceAttachment).countBy({taskId:q.id}),1);
        const content=await storage.content(file.key);await content.close();
        assert.equal((await fs.readdir(path.join(root,'tmp'))).length,0);
      } catch (error) { failure=error; throw error; }
      finally {await cleanupTestRunner(runner,failure,retry);}
    });
    await t.test('Issue reassignment revokes upload/content/retry; Item/Issue upload leaves versions unchanged',async()=>{
      const f=await fault(); const before=await inspections.getIssue(p.id,f.id,manager), key=randomUUID();
      const attached=await upload({issueId:f.id},tech,key);
      const itemAttached=await upload({inspectionItemId:before.item.id},manager);
      assert.deepEqual(await inspections.getIssue(p.id,f.id,manager),before);
      await inspections.assignIssue(p.id,f.id,{expectedVersion:before.version,assigneeId:other.id},manager);
      await rejects(upload({issueId:f.id},tech,key),404);
      await rejects(svc.content(p.id,attached.id,tech,false),404);
      const current=await svc.content(p.id,attached.id,other,false); await current.handle.close();
      await rejects(svc.content(p.id,itemAttached.id,other,false),403);
    });
    await t.test('Nest boot + HTTP upload/content/preview/auth/DTO/limits/signature/deleted responses',async httpTest=>{
      process.env.DB_NAME=name; process.env.JWT_SECRET=randomBytes(48).toString('hex');
      const { NestFactory }=require('@nestjs/core'),{ValidationPipe}=require('@nestjs/common'),{JwtService}=require('@nestjs/jwt');
      app=await NestFactory.create(require('../dist/app.module').AppModule,{logger:false});
      app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true})); await app.listen(0,'127.0.0.1'); await verify(app.get(DataSource));
      assert.equal(app.get(DataSource).options.database,name); const base='http://127.0.0.1:'+app.getHttpServer().address().port;
      assert.deepEqual(await (await fetch(base+'/health')).json(),{status:'ok',database:'connected'});
      const auth={}; for(const u of [manager,tech,other]) auth[u.id]={Authorization:'Bearer '+await app.get(JwtService).signAsync({sub:u.id,authVersion:u.authVersion})};
      const q=await task(); const url=`/projects/${p.id}/tasks/${q.id}/evidence`;
      const send=async(user, key=randomUUID(), buffer=png, mime='image/png', filename='evidence.png', caption=' note ')=>{
        const form=new FormData(); form.append('file',new Blob([buffer],{type:mime}),filename); form.append('caption',caption);
        return fetch(base+url,{method:'POST',headers:{...(user?auth[user.id]:{}),...(key?{'Idempotency-Key':key}:{})},body:form}); };
      await httpTest.test('write error during unfinished HTTP upload terminates within deadline and cleans streams/temp', {timeout:8000},async()=>{
        const http=require('node:http'),{createWriteStream}=require('node:fs');
        const actualStorage=app.get(EvidenceStorage),originalFactory=actualStorage.writeStream;
        const outputs=[],unhandled=[];let request;
        const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);
        actualStorage.writeStream=file=>{
          const output=createWriteStream(file,{flags:'wx',mode:0o600});outputs.push(output);
          const write=output._write;
          output._write=function(chunk,encoding,callback){write.call(this,chunk,encoding,error=>callback(error??new Error('Injected write failure '+file)));};
          return output;
        };
        try {
          const boundary='evidence-'+randomUUID(),key=randomUUID();
          const response=await new Promise((resolve,reject)=>{
            request=http.request(base+url,{method:'POST',headers:{...auth[tech.id],'Idempotency-Key':key,'Content-Type':'multipart/form-data; boundary='+boundary},signal:AbortSignal.timeout(4000)},res=>{
              request.end();const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
              res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
            });
            request.on('error',reject);
            request.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.png"\r\nContent-Type: image/png\r\n\r\n`);
            request.write(Buffer.concat([png,Buffer.alloc(128*1024)]));
            // Deliberately do not end the multipart body: sink failure must stop Busboy itself.
          });
          assert.equal(response.status,503);assert.equal(response.body.includes(root),false);assert.equal(response.body.includes('Injected'),false);
          assert.equal(outputs.length,1);assert.equal(outputs[0].destroyed,true);assert.equal(outputs[0].closed,true);
          assert.deepEqual(await fs.readdir(path.join(root,'tmp')),[]);
          assert.equal(await db.getRepository(EvidenceAttachment).countBy({taskId:q.id}),0);
          await new Promise(r=>setImmediate(r));assert.deepEqual(unhandled,[]);
          actualStorage.writeStream=originalFactory;
          assert.equal((await send(tech,key)).status,201,'failed receive leaves no idempotency record');
        } finally {actualStorage.writeStream=originalFactory;request?.destroy();process.off('unhandledRejection',onUnhandled);}
      });
      assert.equal((await send(null)).status,401); assert.equal((await send(other)).status,404); assert.equal((await send(tech,null)).status,400);
      assert.equal((await send(tech,randomUUID(),Buffer.from('bad'),'image/png')).status,415);
      assert.equal((await send(tech,randomUUID(),Buffer.alloc(0))).status,400);
      assert.equal((await send(tech,randomUUID(),Buffer.alloc(10*1024*1024+1))).status,413);
      const boundary=Buffer.alloc(10*1024*1024);png.copy(boundary);
      assert.equal((await send(tech,randomUUID(),boundary)).status,201,'exactly 10 MiB is allowed');
      assert.equal((await send(tech,randomUUID(),png,'image/png','image.png','x'.repeat(1001))).status,400);
      const key=randomUUID(); const result=await send(tech,key); assert.equal(result.status,201); const record=await result.json();
      assert.equal((await (await send(tech,key,png,'image/png','evidence.png','note')).json()).id,record.id);
      assert.equal((await send(tech,key,png,'image/png','evidence.png','other')).status,409);
      const contentUrl=`/projects/${p.id}/evidence/${record.id}`;
      for(const suffix of ['/content','/preview']) {
        assert.equal((await fetch(base+contentUrl+suffix)).status,401);
        assert.equal((await fetch(base+contentUrl+suffix,{headers:auth[other.id]})).status,404);
        const content=await fetch(base+contentUrl+suffix,{headers:auth[tech.id]}); assert.equal(content.status,200);
        assert.equal(content.headers.get('cache-control'),'private, no-store'); assert.deepEqual(Buffer.from(await content.arrayBuffer()),png);
      }
      const json=async(method,body,user=manager)=>fetch(base+contentUrl,{method,headers:{...auth[user.id],'Content-Type':'application/json'},body:JSON.stringify(body)});
      for(const body of [{},{expectedVersion:null,caption:null},{expectedVersion:1}]) assert.equal((await json('PATCH',body)).status,400);
      assert.equal((await json('PATCH',{expectedVersion:1,caption:null})).status,200);
      assert.equal((await json('DELETE',{expectedVersion:1,reason:'Remove'})).status,409);
      assert.equal((await json('DELETE',{expectedVersion:2,reason:' '})).status,400);
      assert.equal((await json('DELETE',{expectedVersion:2,reason:'Remove'})).status,204);
      assert.equal((await fetch(base+contentUrl+'/preview',{headers:auth[tech.id]})).status,404);
      assert.equal((await send(tech,key)).status,404);
      const s=await sheet(); const itemUrl=`/projects/${p.id}/inspections/${s.id}/items/${s.items[0].id}/evidence`;
      assert.equal((await fetch(base+itemUrl,{headers:auth[tech.id]})).status,403);
      assert.deepEqual(await (await fetch(base+itemUrl,{headers:auth[manager.id]})).json(),[]);
      const pdf=new FormData();pdf.append('file',new Blob([Buffer.from('%PDF-1.4\nDemo\n%%EOF')],{type:'application/pdf'}),'demo.pdf');
      const pr=await fetch(base+itemUrl,{method:'POST',headers:{...auth[manager.id],'Idempotency-Key':randomUUID()},body:pdf});assert.equal(pr.status,201);
      const pe=await pr.json();assert.equal((await fetch(base+`/projects/${p.id}/evidence/${pe.id}/preview`,{headers:auth[manager.id]})).status,400);
      assert.equal((await fetch(base+`/projects/${p2.id}/evidence/${pe.id}/content`,{headers:auth[manager.id]})).status,404);
      await app.close();app=undefined;
    });
    await t.test('isolated down/up removes only evidence schema, preserves all business rows and disk',async()=>{
      const before={};for(const table of ['users','projects','project_tasks','project_inspections','inspection_items','remediation_issues']) before[table]=await db.query(table==='users'?'SELECT id,email,role,is_active FROM users ORDER BY id':`SELECT * FROM ${table} ORDER BY id`);
      const files=await fs.readdir(path.join(root,'files'));
      await verify(); await db.undoLastMigration(); // Remove the later User security migration before the evidence migration sequence.
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name,'CreateProjectAcceptances1802000000000');
      await verify(); await db.undoLastMigration();
      assert.equal((await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1'))[0].name,'CreateEvidenceAttachments1801000000000');
      await verify(); await db.undoLastMigration(); assert.equal((await db.query("SELECT to_regclass('evidence_attachments') name"))[0].name,null);
      for(const [table,rows] of Object.entries(before)) assert.deepEqual(await db.query(table==='users'?'SELECT id,email,role,is_active FROM users ORDER BY id':`SELECT * FROM ${table} ORDER BY id`),rows);
      assert.deepEqual(await fs.readdir(path.join(root,'files')),files);await verify(); await db.runMigrations();assert.equal(await db.showMigrations(),false);
    });
  } catch (error) { failure = error; }
  finally {
    const errors = [];
    try { if(app) await app.close(); } catch (error) { errors.push(error); }
    for(const [k,v] of Object.entries(previous)) if(v===undefined) delete process.env[k];else process.env[k]=v;
    // Validated mkdtemp directory owned by this test, never repository/demo storage.
    try { if (root) {
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)); assert.ok(path.basename(root).startsWith('elv-evidence-'));
      await fs.rm(root,{recursive:true,force:true});
    } } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(failure ? [failure, ...errors] : errors, `Evidence cleanup incomplete: ${root ?? 'storage not created'}`, { cause: failure ?? errors[0] });
  }
  if (failure) throw failure;
  });
});
