// One real-API browser journey. Reuses disposable-http-db, existing browser
// selectors/workflows and PDF/XLSX readers; never uses demo accounts/servers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { withDisposableHttpDb, closeOwnedDataSource } = require('./disposable-http-db.cjs');
const readWorkbook = require('./read-xlsx.cjs');
const { User } = require('../dist/users/user.entity');
const { seedTemplates } = require('../dist/inspections/seed-templates');
const { DataSource } = require('typeorm');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

// Keep ownership before initialize/create can reject: Nest cannot return an app
// on a DI failure. Replace only the root DB registration, not business modules.
function ownedBootstrap(db, verify, fault) {
  const { Module } = require('@nestjs/common');
  const { TypeOrmModule } = require('@nestjs/typeorm');
  const { ExpressAdapter } = require('@nestjs/platform-express');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const sources = [], factories = [], adapter = new ExpressAdapter();
  let app, closing = false;
  const checkOpen = () => { if (closing) throw new Error('Owned bootstrap is closing'); };
  class BrowserModule {}
  const imports = Reflect.getMetadata('imports', AppModule);
  assert.equal(imports.filter(m => m.module === TypeOrmModule).length, 1);
  Module({
    imports: imports.map(m => m.module !== TypeOrmModule ? m : TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...db.options, retryAttempts: 1, toRetry: () => false }),
      dataSourceFactory: options => {
        // Register the entire factory before executing any await (even verify).
        const work = Promise.resolve().then(async () => {
          checkOpen(); assert.equal(options.database, db.options.database);
          await verify(); checkOpen();
          const source = new DataSource(options); sources.push(source);
          if (fault === 'partial') source.buildMetadatas = async () => { throw new Error('controlled partial bootstrap failure'); };
          await source.initialize(); checkOpen();
          await verify(source); checkOpen(); return source;
        });
        factories.push(work);
        return work;
      },
    })),
    controllers: Reflect.getMetadata('controllers', AppModule),
    providers: fault === 'di' ? [{ provide: 'controlled-bootstrap-failure', inject: [DataSource],
      useFactory: () => { throw new Error('controlled DI bootstrap failure'); } }]
      : fault?.kind === 'verify-race' ? [{ provide: 'independent-bootstrap-failure',
        useFactory: async () => { await fault.entered; throw new Error('controlled independent bootstrap failure'); } }] : [],
  })(BrowserModule);
  return {
    sources, factories,
    isClosing: () => closing,
    isListening: () => !!adapter.getHttpServer()?.listening,
    async create() { app = await NestFactory.create(BrowserModule, adapter, { logger: false, abortOnError: false }); return app; },
    async close() {
      closing = true;
      const errors = [];
      // Drain registrations, including work registered while an earlier batch
      // settles. Any factory entering after closing cannot allocate a pool.
      let drained = 0;
      while (drained < factories.length) {
        const batch = factories.slice(drained); drained += batch.length;
        await Promise.allSettled(batch);
      }
      for (const close of [() => app?.close(), () => adapter.close(),
        ...sources.map(source => () => closeOwnedDataSource(source))]) {
        try { await close(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Owned bootstrap cleanup failed');
    },
  };
}

test('bootstrap cleanup cancels factory waiting in verify before pool creation', { timeout: 60000 }, async () => {
  await withDisposableHttpDb('browser', async (db, verify) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-browser-e2e-'));
    const previousStorage = process.env.EVIDENCE_STORAGE_DIR;
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    const bootstrap = ownedBootstrap(db, async () => {
      await verify(); enter(); await barrier;
    }, { kind: 'verify-race', entered });
    let cleanup, cleanupDone = false;
    try {
      process.env.EVIDENCE_STORAGE_DIR = path.join(root, 'evidence');
      await fs.mkdir(process.env.EVIDENCE_STORAGE_DIR);
      await assert.rejects(bootstrap.create(), /controlled independent bootstrap failure/);
      assert.equal(bootstrap.factories.length, 1);
      assert.equal(bootstrap.sources.length, 0);
      cleanup = bootstrap.close().then(() => { cleanupDone = true; });
      assert.equal(bootstrap.isClosing(), true);
      assert.equal(cleanupDone, false, 'cleanup must wait for the registered factory');
      release(); await cleanup;
      const [factory] = await Promise.allSettled(bootstrap.factories);
      assert.equal(factory.status, 'rejected');
      assert.match(factory.reason.message, /bootstrap is closing/);
      assert.equal(bootstrap.sources.length, 0, 'no pool may be created after cleanup starts');
      assert.equal(bootstrap.isListening(), false);
      const [row] = await db.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()');
      assert.equal(row.count, 0);
    } finally {
      release();
      try { await (cleanup || bootstrap.close()); } finally {
        if (previousStorage === undefined) delete process.env.EVIDENCE_STORAGE_DIR;
        else process.env.EVIDENCE_STORAGE_DIR = previousStorage;
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(root).startsWith('elv-browser-e2e-'));
        assert.ok(!path.resolve(root).startsWith(path.resolve(__dirname, '../..') + path.sep));
        await fs.rm(root, { recursive: true, force: true });
      }
    }
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  });
});

async function waitForDownload(page, click, timeout = 45000) {
  // Observe and settle both promises even when click fails first. Never leave a
  // download rejection pending after the caller starts closing the browser.
  const [transfer, action] = await Promise.allSettled([
    page.waitForEvent('download', { timeout }), Promise.resolve().then(click),
  ]);
  if (action.status === 'rejected') throw action.reason;
  if (transfer.status === 'rejected') throw transfer.reason;
  return transfer.value;
}

test('bootstrap failures close owned pools and temporary database', { timeout: 90000 }, async () => {
  for (const fault of ['di', 'partial']) {
    await withDisposableHttpDb('browser', async (db, verify) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-browser-e2e-'));
      const previousStorage = process.env.EVIDENCE_STORAGE_DIR;
      assert.ok(!path.resolve(root).startsWith(path.resolve(__dirname, '../..') + path.sep));
      process.env.EVIDENCE_STORAGE_DIR = path.join(root, 'evidence');
      await fs.mkdir(process.env.EVIDENCE_STORAGE_DIR);
      const bootstrap = ownedBootstrap(db, verify, fault);
      try {
        await assert.rejects(bootstrap.create(), new RegExp(`controlled ${fault === 'di' ? 'DI' : 'partial'} bootstrap failure`));
      } finally {
        try { await bootstrap.close(); } finally {
          if (previousStorage === undefined) delete process.env.EVIDENCE_STORAGE_DIR;
          else process.env.EVIDENCE_STORAGE_DIR = previousStorage;
          assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
          assert.ok(path.basename(root).startsWith('elv-browser-e2e-'));
          await fs.rm(root, { recursive: true, force: true });
        }
      }
      await assert.rejects(fs.stat(root), { code: 'ENOENT' });
      assert.equal(bootstrap.isListening(), false);
      assert.equal(bootstrap.sources.length, 1);
      for (const source of bootstrap.sources) {
        assert.equal(source.isInitialized, false);
        assert.ok(!source.driver.master, 'owned pool must be disconnected');
      }
      const [row] = await db.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()');
      assert.equal(row.count, 0, 'no bootstrap session may remain');
    }); // The existing helper verifies zero sessions and guarded DROP.
  }
});

test('download click failure and timeout settle before browser cleanup', { timeout: 30000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE });
  try {
    const page = await browser.newPage(); await page.setContent('<button>Does not download</button>');
    await assert.rejects(waitForDownload(page, () => page.getByRole('button', { name: 'Missing' }).click({ timeout: 100 }), 300), /click: Timeout/);
    await assert.rejects(waitForDownload(page, () => page.getByRole('button').click(), 300), /Timeout.*download/s);
    assert.equal(page.listenerCount('download'), 0, 'download waiters must be removed');
  } finally { await browser.close(); }
  assert.equal(browser.isConnected(), false);
});

async function readZip(filename) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('error', reject); zip.on('end', () => resolve(entries));
      zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
        if (error) { zip.close(); reject(error); return; }
        const chunks=[]; stream.on('data', b=>chunks.push(b)); stream.on('error', reject);
        stream.on('end', ()=>{entries.set(entry.fileName, Buffer.concat(chunks));zip.readEntry();});
      }));
      zip.readEntry();
    });
  });
}

test('isolated Chrome / real API end-to-end main journey', { timeout: 600000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  assert.ok(process.env.CHROME_EXECUTABLE, 'Set CHROME_EXECUTABLE to an existing Chrome/Edge; no browser installation');
  const python = process.env.EXPORT_PYTHON_BIN || 'python';
  execFileSync(python, ['-c', 'import pypdf,pdfplumber'], { timeout: 15000, stdio: 'pipe' });
  const qa = await fs.mkdtemp(path.join(os.tmpdir(), 'elv-browser-qa-'));
  console.log('Sanitized QA directory: '+qa);
  const secrets=[]; let stage='setup', page, browser, app, bootstrap, vite, root, failure;
  const passed=[];
  const previous={JWT_SECRET:process.env.JWT_SECRET,EVIDENCE_STORAGE_DIR:process.env.EVIDENCE_STORAGE_DIR};
  const cleanError = error => {
    let text=String(error?.message || error);
    for(const value of secrets) text=text.split(value).join('[redacted]');
    return new Error(`E2E stage ${stage}: ${text}`);
  };
  await withDisposableHttpDb('browser', async (db, verify) => {
    const phase = async (name, action) => {
      stage=name; console.log('START '+name); await verify(); await action();
      passed.push(name); console.log('PASS '+name);
    };
    try {
      await verify();
      root=await fs.mkdtemp(path.join(os.tmpdir(),'elv-browser-e2e-'));
      process.env.EVIDENCE_STORAGE_DIR=path.join(root,'evidence');
      process.env.JWT_SECRET=randomBytes(48).toString('hex');secrets.push(process.env.JWT_SECRET);
      assert.ok(path.isAbsolute(root));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
      assert.ok(!path.resolve(root).startsWith(path.resolve(__dirname,'../..')+path.sep));
      const bcrypt=require('bcryptjs'), people={};
      for(const [key,role] of [['manager','MANAGER'],['a','TECHNICIAN'],['b','TECHNICIAN']]) {
        const password=randomBytes(24).toString('base64url');secrets.push(password);
        const email=`${key}-${randomUUID()}@browser.invalid`;
        const row=await db.getRepository(User).save({email,role,isActive:true,mustChangePassword:false,passwordHash:await bcrypt.hash(password,10)});
        people[key]={...row,password};secrets.push(row.passwordHash);
      }
      await seedTemplates(db);
      const {ValidationPipe}=require('@nestjs/common');
      bootstrap=ownedBootstrap(db,verify);
      app=await bootstrap.create();
      app.enableCors({exposedHeaders:['Content-Disposition','Retry-After']});
      app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));
      await app.listen(0,'127.0.0.1');await verify(app.get(DataSource));
      const storageRoot=await app.get(require('../dist/evidence/evidence.storage').EvidenceStorage).root();
      assert.equal(storageRoot,await fs.realpath(path.join(root,'evidence')),'the actual storage service must use only the owned directory');
      const api=await app.getUrl();assert.notEqual(new URL(api).port,'3000');
      const request=async (who,method,endpoint,body,status=200) => {
        await verify(app.get(DataSource));
        assert.ok(endpoint.startsWith('/'));assert.equal(new URL(api+endpoint).origin,api);
        const res=await fetch(api+endpoint,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:'Bearer '+people[who].token}:{})},
          ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
        assert.equal(res.status,status,`${method} ${endpoint}: expected ${status}, received ${res.status}`);
        return res.status===204?null:res.json();
      };
      assert.equal((await request(null,'GET','/health')).database,'connected');
      for(const key of Object.keys(people)) {
        people[key].token=(await request(null,'POST','/auth/login',{email:people[key].email,password:people[key].password},201)).accessToken;
        secrets.push(people[key].token);
      }
      const {createServer}=await import('vite');const react=(await import('@vitejs/plugin-react')).default;
      // Vite 6 treats port:0 as its default 5173. Reserve an OS-assigned port,
      // then strictPort fails safely if another process wins the bind race.
      const probe=require('node:net').createServer();
      await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
      const vitePort=probe.address().port;await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
      vite=await createServer({root:path.resolve(__dirname,'../../frontend'),configFile:false,envDir:root,cacheDir:path.join(root,'vite-cache'),
        plugins:[react({include:/\.tsx$/})],define:{'import.meta.env.VITE_API_URL':JSON.stringify(api)},
        server:{host:'127.0.0.1',port:vitePort,strictPort:true},customLogger:{hasWarned:false,info(){},warn(){},warnOnce(){},error(){},clearScreen(){},hasErrorLogged(){return false;}}});
      await vite.listen();const web=`http://127.0.0.1:${vite.httpServer.address().port}`;
      assert.notEqual(new URL(web).port,'5173');
      browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE});
      const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      // Never forward requests to a local server other than the two owned origins.
      const unexpected=[];
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if([api,web].includes(url.origin))return route.continue();
        if(['data:','blob:'].includes(url.protocol))return route.continue();
        unexpected.push(url.origin);await route.abort();
      });
      page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
      const runtimeErrors=[];page.on('pageerror',()=>runtimeErrors.push('browser runtime error'));
      page.on('dialog',dialog=>dialog.accept());
      let project,base,system,room,rack,sw,camera,task,oldEvidence,ownEvidence,sheet,confirmed,replacement;
      const code='E2E-'+randomUUID().slice(0,8).toUpperCase();
      const dialog=()=>page.getByRole('dialog');
      const settled=()=>page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'));
      const close=async()=>{await dialog().getByRole('button',{name:'Đóng',exact:true}).click();await dialog().waitFor({state:'hidden'});};
      const signIn=async who=>{
        if(await page.getByRole('button',{name:'Đăng xuất',exact:true}).count())await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
        await page.goto(web);await page.getByLabel('Email',{exact:true}).fill(people[who].email);
        await page.getByLabel('Mật khẩu',{exact:true}).fill(people[who].password);
        await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.locator('.project-rail').waitFor();
      };
      const select=async()=>{await page.locator('.project-row').filter({hasText:code}).click();await page.locator('.overview-links').waitFor();await settled();};
      const overview=async()=>{
        if(await dialog().count())await close();
        if(await page.locator('.rack-workspace').count())await page.getByRole('button',{name:'← Tổng quan công trình',exact:true}).click();
        else if(!await page.locator('.overview-links').count())await page.getByRole('button',{name:'Về tổng quan',exact:true}).click();
        await page.locator('.overview-links').waitFor();await settled();
      };
      const section=async name=>{await overview();await page.locator('.overview-links').getByRole('button',{name:new RegExp(name)}).click();await settled();};
      const download=async(label,scope=dialog())=>{
        const file=await waitForDownload(page,()=>scope.getByRole('button',{name:label,exact:true}).click());assert.equal(await file.failure(),null);
        const destination=path.join(root,path.basename(file.suggestedFilename()));await file.saveAs(destination);return destination;
      };

      await phase('1 UI Project/FLOOR/ROOM/System',async()=>{
        await signIn('manager');await page.getByRole('button',{name:'Tạo mới',exact:true}).click();
        await dialog().getByLabel('Mã công trình',{exact:true}).fill(code);await dialog().getByLabel('Tên công trình',{exact:true}).fill('Công trình E2E cách ly');
        await dialog().getByRole('button',{name:'Lưu công trình',exact:true}).click();await dialog().waitFor({state:'hidden'});
        project=(await request('manager','GET','/projects')).find(p=>p.code===code);assert.ok(project);base=`/projects/${project.id}`;
        if(!await page.locator('.overview-links').count())await select();
        await section('Khu vực & hệ thống');await page.getByRole('button',{name:'＋ Tầng',exact:true}).click();
        await dialog().getByLabel('Mã tầng',{exact:true}).fill('F01');await dialog().getByLabel('Tên hiển thị',{exact:true}).fill('Tầng E2E');
        await dialog().getByRole('button',{name:'Lưu khu vực',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        await page.getByRole('button',{name:'Thêm phòng vào Tầng E2E',exact:true}).click();
        await dialog().getByLabel('Mã phòng',{exact:true}).fill('R01');await dialog().getByLabel('Tên hiển thị',{exact:true}).fill('Phòng E2E');
        await dialog().getByRole('button',{name:'Lưu khu vực',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        await page.getByRole('button',{name:'＋ Hạng mục',exact:true}).click();
        await dialog().getByLabel('Mã hạng mục',{exact:true}).fill('CAM');await dialog().getByLabel('Tên hạng mục',{exact:true}).fill('Camera E2E');
        await dialog().getByRole('combobox').selectOption('CAMERA');await dialog().getByRole('button',{name:'Lưu hạng mục',exact:true}).click();
        await dialog().waitFor({state:'hidden'});await settled();
        system=(await request('manager','GET',base+'/systems'))[0];room=(await request('manager','GET',base+'/areas')).find(a=>a.type==='ROOM');assert.ok(room&&system);
      });
      await phase('2 API equipment/ports; UI placement/network/trace',async()=>{
        const create=body=>request('manager','POST',base+'/devices',body,201);
        rack=await create({code:'RACK',name:'Tủ E2E',type:'RACK',areaId:room.id,capacityU:12,systemIds:[system.id]});
        sw=await create({code:'SW',name:'Switch E2E',type:'SWITCH',rackId:rack.id,systemIds:[system.id]});
        camera=await create({code:'CAM-01',name:'Camera E2E',type:'CAMERA',areaId:room.id,systemIds:[system.id]});
        const cp=await request('manager','POST',`${base}/devices/${camera.id}/ports`,{code:'ETH1'},201);
        const sp=await request('manager','POST',`${base}/devices/${sw.id}/ports`,{code:'P01',accessVlanId:20,poeEnabled:true},201);
        await request('manager','POST',base+'/connections',{kind:'PATCH',a:{portId:cp.id,side:'SINGLE'},b:{portId:sp.id,side:'SINGLE'},label:'CAM-UPLINK'},201);
        await section('Sơ đồ tủ');await page.getByRole('button',{name:'Xếp / chuyển thiết bị',exact:true}).click();
        await dialog().getByLabel('Thiết bị',{exact:true}).selectOption(sw.id);await dialog().getByLabel('Kiểu lắp',{exact:true}).selectOption('U');
        await dialog().getByLabel('U bắt đầu',{exact:true}).fill('1');await dialog().getByLabel('Chiều cao (U)',{exact:true}).fill('1');
        await dialog().getByRole('button',{name:'Lưu vị trí',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        assert.equal(await page.locator('.rack-unit-number').last().innerText(),'U1');assert.ok(await page.locator('.rack-mounted').filter({hasText:'SW'}).count());
        await section('Đấu nối');await page.locator('.connection-profile-list li').filter({hasText:'CAM-01'}).getByRole('button',{name:'Xem / sửa hồ sơ',exact:true}).click();
        await dialog().getByLabel('Cách cấp IP',{exact:true}).selectOption('STATIC');await dialog().getByLabel('IPv4',{exact:true}).fill('192.0.2.10');
        await dialog().getByLabel('MAC',{exact:true}).fill('02:00:00:00:00:10');await dialog().getByRole('button',{name:'Lưu hồ sơ mạng',exact:true}).click();
        await dialog().waitFor({state:'hidden'});await settled();
        const trace=await request('manager','GET',base+'/connections/trace?deviceCode=CAM-01');assert.equal(trace.paths[0].complete,true);
        assert.equal(trace.paths[0].switchPort.accessVlanId,20);assert.equal(trace.paths[0].switchPort.poeEnabled,true);
        await page.getByLabel('Mã tra cứu',{exact:true}).fill('CAM-01');
        await page.getByRole('button',{name:'Tra đường đi',exact:true}).click();await page.locator('.trace-result').waitFor();
        assert.ok((await dialog().innerText()).includes('192.0.2.10'));assert.ok((await dialog().innerText()).includes('VLAN 20'));await close();
      });
      await phase('3 API Task/evidence A; UI reassign B/upload/start/submit/approve',async()=>{
        task=await request('manager','POST',base+'/tasks',{code:'TASK-01',title:'Công việc E2E',systemId:system.id,assigneeId:people.a.id},201);
        const form=new FormData();form.set('file',new Blob([png],{type:'image/png'}),'a-evidence.png');form.set('caption','Minh chứng của A');
        const res=await fetch(`${api}${base}/tasks/${task.id}/evidence`,{method:'POST',headers:{Authorization:'Bearer '+people.a.token,'Idempotency-Key':randomUUID()},body:form,signal:AbortSignal.timeout(15000)});
        assert.equal(res.status,201);oldEvidence=await res.json();
        await section('Công việc');await page.locator('.task-row').getByRole('button',{name:'Sửa / giao lại',exact:true}).click();
        await dialog().getByLabel('Kỹ thuật viên').selectOption(people.b.id);await dialog().getByRole('button',{name:'Lưu công việc',exact:true}).click();
        await dialog().waitFor({state:'hidden'});await settled();
        await request('a','GET',`${base}/tasks/${task.id}`,undefined,404);
        for(const suffix of ['content','preview']) {
          const denied=await fetch(`${api}${base}/evidence/${oldEvidence.id}/${suffix}`,{headers:{Authorization:'Bearer '+people.a.token},signal:AbortSignal.timeout(15000)});assert.equal(denied.status,404);
        }
        await request('b','PATCH',`${base}/evidence/${oldEvidence.id}`,{expectedVersion:1,caption:'must be forbidden'},403);
        await signIn('b');await select();await section('Công việc');await page.locator('.task-row').getByRole('button',{name:'Xem chi tiết',exact:true}).click();
        const oldRow=dialog().locator('.evidence-row').filter({hasText:'a-evidence.png'});await oldRow.waitFor();assert.equal(await oldRow.getByRole('button',{name:'Xóa minh chứng'}).count(),0);
        await dialog().getByLabel('File minh chứng',{exact:true}).setInputFiles({name:'b-evidence.png',mimeType:'image/png',buffer:png});
        await dialog().getByLabel('Chú thích file',{exact:true}).fill('Minh chứng của B');await dialog().getByRole('button',{name:'Tải minh chứng lên',exact:true}).click();
        const ownRow=dialog().locator('.evidence-row').filter({hasText:'b-evidence.png'});await ownRow.waitFor();
        await ownRow.locator('img').waitFor();assert.equal(await ownRow.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
        const evidenceFile=await download('Tải xuống',ownRow);assert.deepEqual(await fs.readFile(evidenceFile),png);
        ownEvidence=(await request('b','GET',`${base}/tasks/${task.id}/evidence`)).find(e=>e.originalName==='b-evidence.png');
        await close();await page.locator('.task-row').getByRole('button',{name:'Bắt đầu',exact:true}).click();await settled();
        await page.locator('.task-row').getByRole('button',{name:'Gửi duyệt',exact:true}).click();await dialog().getByRole('textbox').fill('Đã làm và kiểm tra E2E');
        await dialog().getByRole('button',{name:'Gửi duyệt',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        await signIn('manager');await select();await section('Công việc');await page.locator('.task-row').getByRole('button',{name:'Duyệt',exact:true}).click();await settled();
        assert.equal((await request('manager','GET',`${base}/tasks/${task.id}`)).status,'APPROVED');
      });
      await phase('4 UI checklist FAIL/resolve/recheck FAIL/resolve/PASS',async()=>{
        await section('Kiểm tra');await page.getByRole('button',{name:'＋ Tạo phiếu',exact:true}).click();
        await dialog().getByLabel('Mã phiếu',{exact:true}).fill('CHECK-01');await dialog().getByLabel('Tên phiếu',{exact:true}).fill('Phiếu E2E');
        await dialog().getByLabel('System').selectOption(system.id);
        const templates=await request('manager','GET','/checklist-templates?category=CAMERA');
        await dialog().getByLabel('Mẫu checklist').selectOption(templates[0].id);
        await dialog().getByRole('button',{name:'Tạo phiếu',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        const openSheet=async()=>{await page.locator('.inspection-sheet').filter({hasText:'CHECK-01'}).click();};
        await openSheet();await dialog().getByRole('button',{name:'Ghi kết quả',exact:true}).first().click();
        await dialog().getByLabel('Kết quả').selectOption('FAIL');await dialog().getByLabel('Mô tả lỗi',{exact:true}).fill('Lỗi cần khắc phục E2E');
        await dialog().getByLabel('Kỹ thuật viên').selectOption(people.b.id);await dialog().getByRole('button',{name:'Lưu kết quả',exact:true}).click();
        await dialog().waitFor({state:'hidden'});await settled();
        for(const pass of [false,true]) {
          await signIn('b');await select();await section('Kiểm tra');
          await page.getByRole('button',{name:'Bắt đầu sửa',exact:true}).click();await dialog().getByRole('button',{name:'Bắt đầu sửa',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
          await page.getByRole('button',{name:'Báo đã sửa',exact:true}).click();await dialog().getByLabel('Ghi chú khắc phục',{exact:true}).fill(pass?'Đã sửa lại':'Đã sửa lần đầu');
          await dialog().getByRole('button',{name:'Báo đã sửa',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
          await signIn('manager');await select();await section('Kiểm tra');await page.getByRole('button',{name:'Lỗi khắc phục',exact:true}).click();
          await page.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();await dialog().getByLabel('Kết quả kiểm tra lại').selectOption(pass?'PASS':'FAIL');
          await dialog().getByLabel('Ghi chú kiểm tra lại',{exact:true}).fill(pass?'Kiểm tra đạt':'Chưa đạt');
          if(!pass)await dialog().getByLabel('Lý do trả lỗi',{exact:true}).fill('Cần khắc phục lần hai');
          await dialog().getByRole('button',{name:'Lưu kiểm tra lại',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        }
        sheet=(await request('manager','GET',base+'/inspections'))[0];sheet=await request('manager','GET',`${base}/inspections/${sheet.id}`);
        assert.equal(sheet.items[0].result,'PASS');assert.equal(sheet.items[0].issues[0].status,'CLOSED');
      });
      await phase('5 UI acceptance blockers/confirm/replacement; API remaining PASS items',async()=>{
        await page.getByRole('button',{name:'Hồ sơ nghiệm thu',exact:true}).click();await page.getByRole('button',{name:'Tạo hồ sơ',exact:true}).click();
        const fillAcceptance=async(code,title)=>{await dialog().getByLabel('Mã hồ sơ',{exact:true}).fill(code);await dialog().getByLabel('Tên hồ sơ',{exact:true}).fill(title);};
        await fillAcceptance('AC-01','Hồ sơ E2E');await dialog().getByLabel('System').selectOption(system.id);
        await dialog().getByLabel(/CHECK-01/).check();await dialog().getByLabel(/b-evidence.png/).check();
        await dialog().getByRole('button',{name:'Lưu nháp',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        const openAcceptance=async code=>{
          await page.locator('.item-list li').filter({hasText:code}).getByRole('button',{name:'Xem hồ sơ',exact:true}).click();
          await dialog().waitFor();
          if(await dialog().getByRole('button',{name:'Tải lại readiness',exact:true}).count()) {
            await dialog().getByRole('button',{name:'Tải lại readiness',exact:true}).click();
            await dialog().getByRole('heading',{name:'Điều kiện xác nhận',exact:true}).waitFor();
          }
        };
        await openAcceptance('AC-01');await dialog().getByRole('heading',{name:'Điều kiện xác nhận',exact:true}).waitFor();
        assert.equal(await dialog().getByRole('button',{name:'Xác nhận phạm vi đã chọn',exact:true}).isDisabled(),true);await close();
        for(const item of sheet.items.filter(i=>i.result!=='PASS'))await request('manager','PUT',`${base}/inspections/${sheet.id}/items/${item.id}/result`,{expectedVersion:item.version,result:'PASS',note:'Mục nền được kiểm tra qua API'});
        await openAcceptance('AC-01');await dialog().getByRole('button',{name:'Xác nhận phạm vi đã chọn',exact:true}).click();await dialog().waitFor({state:'hidden'});await settled();
        confirmed=(await request('manager','GET',base+'/acceptances')).find(a=>a.code==='AC-01');assert.equal(confirmed.status,'CONFIRMED');
        await openAcceptance('AC-01');await dialog().getByRole('button',{name:'Tạo bản thay thế',exact:true}).click();
        await fillAcceptance('AC-02','Hồ sơ thay thế E2E');await dialog().getByLabel('Lý do thay thế',{exact:true}).fill('Minh họa thay thế có lịch sử');
        await dialog().getByLabel(/CHECK-01/).check();await dialog().getByLabel(/b-evidence.png/).check();await dialog().getByRole('button',{name:'Lưu nháp',exact:true}).click();
        await dialog().waitFor({state:'hidden'});await settled();await openAcceptance('AC-02');await dialog().getByRole('button',{name:'Xác nhận phạm vi đã chọn',exact:true}).click();
        await dialog().waitFor({state:'hidden'});await settled();replacement=(await request('manager','GET',base+'/acceptances')).find(a=>a.code==='AC-02');
        assert.equal(replacement.status,'CONFIRMED');assert.equal((await request('manager','GET',`${base}/acceptances/${confirmed.id}`)).replacedById,replacement.id);
      });
      await phase('6 UI PDF/XLSX/ZIP downloads; real content/manifest/hash',async()=>{
        await page.locator('.item-list li').filter({hasText:'AC-02'}).getByRole('button',{name:'Xem hồ sơ',exact:true}).click();
        const pdf=await download('Tải PDF'),zip=await download('Tải gói bàn giao ZIP');
        const inspect=file=>JSON.parse(execFileSync(python,[path.join(__dirname,'read-export-pdf.py'),file],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024}));
        assert.ok(inspect(pdf).pages.join('\n').includes(code));assert.ok(inspect(pdf).pages.join('\n').includes('AC-02'));
        const entries=await readZip(zip);const manifest=JSON.parse(entries.get('manifest.json'));
        assert.equal(manifest.acceptance.code,'AC-02');
        for(const file of manifest.files) {const bytes=entries.get(file.path);assert.ok(bytes);assert.equal(bytes.length,file.sizeBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
        assert.ok(manifest.files.some(f=>f.kind==='pinned-evidence'));assert.ok([...entries.keys()].some(k=>k.startsWith('evidence/')));
        for(const file of manifest.files.filter(f=>f.kind==='pinned-evidence'))assert.deepEqual(entries.get(file.path),png);
        const zipPdf=path.join(root,'zip-acceptance.pdf');await fs.writeFile(zipPdf,entries.get('acceptance/acceptance.pdf'));
        assert.ok(inspect(zipPdf).pages.join('\n').includes('AC-02'));
        for(const [entry,sheets] of [['current/devices.xlsx',['Thông tin','Thiết bị','Tủ']],['current/connections.xlsx',['Thông tin','Cổng','Dây','Tra cứu']]]) {
          const file=path.join(root,path.basename(entry));await fs.writeFile(file,entries.get(entry));
          const book=await readWorkbook(file);assert.deepEqual(book.worksheets.map(s=>s.name),sheets);
          assert.ok(String(book.getWorksheet('Thông tin').getRow(2).getCell(2).value).includes(code));
        }
        await close();await section('Thiết bị');const devices=await download('Xuất Excel thiết bị',page);
        await section('Đấu nối');const connections=await download('Xuất Excel đấu nối',page);
        const deviceBook=await readWorkbook(devices),connectionBook=await readWorkbook(connections);
        assert.deepEqual(deviceBook.worksheets.map(s=>s.name),['Thông tin','Thiết bị','Tủ']);assert.deepEqual(connectionBook.worksheets.map(s=>s.name),['Thông tin','Cổng','Dây','Tra cứu']);
        assert.ok(String(deviceBook.getWorksheet('Thông tin').getRow(2).getCell(2).value).includes(code));
        assert.ok(String(connectionBook.getWorksheet('Thông tin').getRow(2).getCell(2).value).includes(code));
        assert.ok(connectionBook.getWorksheet('Tra cứu').rowCount>1);
      });
      await phase('7 UI summary/filter/reload/TECHNICIAN/mobile/keyboard',async()=>{
        await overview();assert.equal(await page.locator('.overview-links button').count(),6);assert.equal(await page.locator('.tasks-panel,.devices-panel,.connections-panel').count(),0);
        await page.getByRole('button',{name:/Đã thay thế/}).click();await settled();
        assert.equal(await page.getByLabel('Nhóm hồ sơ nghiệm thu',{exact:true}).inputValue(),'superseded');
        assert.equal(await page.locator('.item-list li').count(),1);assert.ok((await page.locator('.item-list').innerText()).includes('AC-01'));
        await overview();await page.locator('.overview-links').getByRole('button',{name:/Kiểm tra/}).click();await settled();
        await page.getByRole('button',{name:'Hồ sơ nghiệm thu',exact:true}).click();
        assert.equal(await page.getByLabel('Nhóm hồ sơ nghiệm thu',{exact:true}).inputValue(),'');await overview();
        await page.screenshot({path:path.join(qa,'desktop.png'),fullPage:true});
        await page.reload();await select();await page.setViewportSize({width:390,height:844});await settled();
        await page.locator('.overview-links button').first().focus();await page.keyboard.press('Enter');await settled();
        assert.ok(await page.getByRole('heading',{name:'Khu vực & hệ thống',exact:true}).count());await overview();
        await page.screenshot({path:path.join(qa,'mobile-390.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await signIn('a');await select();await section('Công việc');assert.equal(await page.locator('.task-row').count(),0);
        await signIn('b');await select();await section('Công việc');assert.ok(await page.locator('.task-row').count());assert.equal(await page.getByRole('button',{name:'Sửa / giao lại',exact:true}).count(),0);
        await section('Kiểm tra');await page.getByRole('button',{name:'Hồ sơ nghiệm thu',exact:true}).click();
        await page.locator('.item-list li').filter({hasText:'AC-02'}).getByRole('button',{name:'Xem hồ sơ',exact:true}).click();
        await dialog().waitFor();
        await page.waitForFunction(()=>!!document.activeElement?.closest('[role="dialog"]'));
        assert.equal(await dialog().getByRole('button',{name:'Tải PDF',exact:true}).count(),0);assert.equal(await dialog().getByRole('heading',{name:'Snapshot đã xác nhận',exact:true}).count(),0);
        assert.ok((await dialog().innerText()).includes('AC-02'));
        for(const key of ['Tab','Shift+Tab']) {
          await page.keyboard.press(key);assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),true);
        }
        const bounds=await dialog().boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=844);
        await page.screenshot({path:path.join(qa,'technician-dialog-390.png')});
        await page.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.deepEqual(runtimeErrors,[]);assert.deepEqual(unexpected,[]);
      });
      await fs.writeFile(path.join(qa,'result.json'),JSON.stringify({passed,apiSteps:['equipment/ports/connection','Task + A evidence','remaining inspection PASS items'],uiSteps:passed},null,2));
    } catch(error) {
      failure=cleanError(error);
      if(page)try {await page.screenshot({path:path.join(qa,'failure.png'),fullPage:true,mask:[page.locator('input[type=password]')]});}catch{}
      await fs.writeFile(path.join(qa,'failure.txt'),failure.message);
    } finally {
      const errors=[];
      for(const close of [()=>browser?.close(),()=>vite?.close(),()=>bootstrap?.close()])try{await close();}catch(error){errors.push(cleanError(error));}
      for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
      try {if(root){assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('elv-browser-e2e-'));await fs.rm(root,{recursive:true,force:true});}}catch(error){errors.push(cleanError(error));}
      if(errors.length)throw new AggregateError(failure?[failure,...errors]:errors,'E2E cleanup incomplete; check owned resources',{cause:failure??errors[0]});
    }
    if(failure)throw failure;
  });
});
