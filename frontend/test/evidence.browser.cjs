// Optional external Playwright/Chrome; only a uniquely named trial Project is written.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const local=require('dotenv').parse(fs.readFileSync(path.resolve(__dirname,'../../backend/.env')));
const api=process.env.EVIDENCE_API_URL||'http://localhost:3000',web=process.env.EVIDENCE_WEB_URL||'http://localhost:5173';
const reuseCode=process.env.EVIDENCE_TRIAL_CODE;
if(reuseCode&&!/^EVIDENCE-UI-[A-Z0-9]+$/.test(reuseCode))throw new Error('Use an explicitly labelled evidence trial Project');
const code=reuseCode||'EVIDENCE-UI-'+randomUUID().slice(0,8).toUpperCase();
const resumeLocks=process.env.EVIDENCE_RESUME_LOCKS==='1';
if(resumeLocks&&!reuseCode)throw new Error('Resume requires an explicit trial Project');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
let stage='environment',base,project,managerToken,created=false;const createdEvidence=new Set();
async function run(){
 const credentials=role=>({email:local[`DEMO_${role}_EMAIL`]||(role==='MANAGER'?'manager.demo@example.local':'technician.demo@example.local'),password:local[`DEMO_${role}_PASSWORD`]});
 const request=async(token,method,endpoint,body,status=200)=>{const r=await fetch(api+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(r.status,status,`${method} ${endpoint}`);return status===204?null:r.json();};
 stage='health';assert.equal((await request(null,'GET','/health')).database,'connected');
 stage='demo authentication';
 managerToken=(await request(null,'POST','/auth/login',credentials('MANAGER'),201)).accessToken;
 const technicianLogin=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials('TECHNICIAN'))});
 const techToken=technicianLogin.ok?(await technicianLogin.json()).accessToken:null;
 const tech=techToken?await request(techToken,'GET','/auth/me'):(await request(managerToken,'GET','/users/technicians')).find(u=>u.email===credentials('TECHNICIAN').email);
 assert.ok(tech,'An active demo technician is needed to assign the trial task');
 if(!techToken)console.log(`LIMIT TECHNICIAN login returned ${technicianLogin.status}; browser ownership/state flow will be skipped`);
 stage='Chrome launch';const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});let page,targets=[];
 try{
  stage='fixture';project=reuseCode?(await request(managerToken,'GET','/projects')).find(p=>p.code===code):await request(managerToken,'POST','/projects',{code,name:'Smoke minh chứng riêng',status:'IN_PROGRESS'},201);assert.ok(project,'Trial Project must exist');assert.equal(project.name,'Smoke minh chứng riêng');base=`/projects/${project.id}`;console.log('Trial Project '+code);
  const system=reuseCode?(await request(managerToken,'GET',base+'/systems')).find(s=>s.code==='LAN'):await request(managerToken,'POST',base+'/systems',{code:'LAN',name:'LAN thử',category:'LAN'},201);assert.ok(system);
  const existingTasks=reuseCode?await request(managerToken,'GET',base+'/tasks'):[];
  const task=reuseCode?existingTasks.find(t=>t.code==='EV-TASK'):await request(managerToken,'POST',base+'/tasks',{code:'EV-TASK',title:'Việc thử minh chứng',systemId:system.id,assigneeId:tech.id},201);
  const task2=reuseCode?existingTasks.find(t=>t.code==='EV-OTHER'):await request(managerToken,'POST',base+'/tasks',{code:'EV-OTHER',title:'Việc đổi target',systemId:system.id,assigneeId:tech.id},201);
  assert.ok(task&&task2);assert.equal(task.status,resumeLocks?'APPROVED':'ASSIGNED');assert.equal(task2.status,'ASSIGNED');assert.equal(task.assigneeId,tech.id);assert.equal(task2.assigneeId,tech.id);
  const template=(await request(managerToken,'GET','/checklist-templates?category=LAN'))[0];
  const sheet=reuseCode?(await request(managerToken,'GET',base+'/inspections')).find(s=>s.code==='EV-SHEET'):await request(managerToken,'POST',base+'/inspections',{code:'EV-SHEET',title:'Phiếu thử minh chứng',systemId:system.id,templateId:template.id},201);assert.ok(sheet);
  const item=reuseCode?sheet.items[0]:await request(managerToken,'PUT',`${base}/inspections/${sheet.id}/items/${sheet.items[0].id}/result`,{expectedVersion:1,result:'FAIL',issue:{description:'Lỗi thử minh chứng',assigneeId:tech.id}});
  const issue=item.activeIssue||(resumeLocks?(await request(managerToken,'GET',base+'/issues')).find(i=>i.item.id===item.id&&i.description==='Lỗi thử minh chứng'):null);assert.ok(issue);
  targets=[`tasks/${task.id}/evidence`,`tasks/${task2.id}/evidence`,`inspections/${sheet.id}/items/${item.id}/evidence`,`issues/${issue.id}/evidence`];
  assert.ok((resumeLocks?['RESOLVED','CLOSED']:['OPEN']).includes(issue.status));assert.equal(issue.assigneeId,tech.id);assert.equal(issue.description,'Lỗi thử minh chứng');
  if(!resumeLocks)for(const target of targets)assert.equal((await request(managerToken,'GET',base+'/'+target)).length,0,'Reuse requires empty visible evidence');created=true;
  page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',()=>errors.push('runtime'));
  page.on('response',async r=>{if(r.request().method()==='POST'&&r.status()===201&&r.url().startsWith(api+base+'/')&&r.url().endsWith('/evidence')){try{createdEvidence.add((await r.json()).id);}catch{/* Unknown response remains for reporting, never broad cleanup. */}}});
  await page.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__evidenceUrls=new Set();URL.createObjectURL=blob=>{const url=create(blob);window.__evidenceUrls.add(url);return url;};URL.revokeObjectURL=url=>{window.__evidenceUrls.delete(url);revoke(url);};});
  const signIn=async role=>{await page.goto(web);await page.getByLabel('Email',{exact:true}).fill(credentials(role).email);await page.getByLabel('Mật khẩu',{exact:true}).fill(credentials(role).password);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.locator('.project-row').filter({hasText:code}).click();};
  const section=async name=>{await page.locator('.overview-links').getByRole('button',{name:new RegExp(name)}).click();};
  const dialog=()=>page.getByRole('dialog'),panel=()=>page.locator('.evidence-panel');
  const settled=async()=>{await panel().waitFor();await page.waitForFunction(()=>document.querySelector('.evidence-panel')?.getAttribute('aria-busy')==='false');};
  const openTask=async which=>{await page.locator('.task-row').filter({hasText:which}).getByRole('button',{name:'Xem chi tiết',exact:true}).click();await settled();};
  const close=async()=>{await dialog().getByRole('button',{name:'Đóng',exact:true}).click();await page.waitForFunction(()=>window.__evidenceUrls.size===0);};
  const choose=async(name,mimeType,buffer)=>panel().getByLabel('File minh chứng',{exact:true}).setInputFiles({name,mimeType,buffer});
  const upload=async()=>{await panel().getByRole('button',{name:'Tải minh chứng lên',exact:true}).click();await settled();};
  await signIn('MANAGER');let jpeg;
  if(!resumeLocks) {
  await page.locator('.overview-links').waitFor();assert.equal(await page.locator('.overview-links').getByRole('button').count(),6);await section('Công việc');await openTask('EV-TASK');
  stage='PNG and retry lost response';let keys=[];const route=`**/projects/${project.id}/tasks/${task.id}/evidence`;
  await page.route(route,async r=>{if(r.request().method()==='POST'){keys.push(r.request().headers()['idempotency-key']);await r.fetch();await r.abort('failed');}else await r.continue();});
  await choose('proof.png','image/png',png);await panel().getByLabel('Chú thích file',{exact:true}).fill(' note ');await upload();await panel().getByRole('alert').waitFor();
  await page.unroute(route);await page.route(route,async r=>{if(r.request().method()==='POST')keys.push(r.request().headers()['idempotency-key']);await r.continue();});
  await upload();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await request(managerToken,'GET',base+'/tasks/'+task.id+'/evidence')).length,1);
  await page.unroute(route);await panel().locator('img').waitFor();
  stage='download';const downloaded=page.waitForEvent('download');await panel().getByRole('button',{name:'Tải xuống',exact:true}).click();assert.equal((await downloaded).suggestedFilename(),'proof.png');
  stage='caption open';await panel().getByRole('button',{name:'Sửa chú thích',exact:true}).click();
  stage='caption field';await panel().getByLabel('Chú thích minh chứng',{exact:true}).fill('');
  stage='caption save';await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();
  stage='caption reload';await settled();assert.equal((await request(managerToken,'GET',base+'/tasks/'+task.id+'/evidence'))[0].caption,null);
  stage='soft delete';await panel().getByRole('button',{name:'Xóa minh chứng',exact:true}).click();await panel().getByLabel('Lý do xóa minh chứng',{exact:true}).fill('Dọn smoke riêng');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();assert.equal((await request(managerToken,'GET',base+'/tasks/'+task.id+'/evidence')).length,0);
  stage='JPEG/PDF and GET failure';jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;return c.toDataURL('image/jpeg').split(',')[1];});
  await choose('proof.jpg','image/jpeg',Buffer.from(jpeg,'base64'));await upload();assert.equal(await panel().locator('.evidence-row').count(),1);
  let posts=0,failGet=false;await page.route(route,async r=>{if(r.request().method()==='POST'){posts++;await r.continue();}else if(failGet)await r.fulfill({status:503,json:{message:'Injected GET failure'}});else await r.continue();});
  await choose('proof.pdf','application/pdf',Buffer.from('%PDF-1.4\nDemo\n%%EOF'));failGet=true;await upload();assert.equal(await panel().locator('.evidence-row').count(),0);assert.equal(await panel().getByLabel('File minh chứng').count(),0);
  failGet=false;await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).click();await settled();assert.equal(posts,1);assert.equal(await panel().locator('.evidence-row').count(),2);await page.unroute(route);
  stage='real stale version';const first=(await request(managerToken,'GET',base+'/tasks/'+task.id+'/evidence'))[0];
  await panel().getByRole('button',{name:'Sửa chú thích',exact:true}).first().click();await panel().getByLabel('Chú thích minh chứng',{exact:true}).fill('Draft giữ khi 409');
  await request(managerToken,'PATCH',`${base}/evidence/${first.id}`,{expectedVersion:first.version,caption:'Thay đổi từ phiên khác'});
  await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();await panel().getByRole('alert').waitFor();assert.equal(await panel().getByLabel('Chú thích minh chứng',{exact:true}).inputValue(),'Draft giữ khi 409');
  await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).click();await settled();assert.equal(await panel().getByLabel('Chú thích minh chứng',{exact:true}).inputValue(),'Draft giữ khi 409');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();
  stage='file validation and layout';await choose('bad.txt','text/plain',Buffer.from('invalid'));await upload();await panel().getByRole('alert').filter({hasText:'Chỉ nhận JPEG/PNG/PDF'}).waitFor();await choose('oversized.png','image/png',Buffer.alloc(10*1024*1024+1));await upload();await panel().getByRole('alert').filter({hasText:'tối đa 10 MiB'}).waitFor();
  const longName='proof-'+ 'long-label-'.repeat(15)+'.png';await choose(longName,'image/png',png);await upload();await panel().getByText(longName,{exact:true}).waitFor();
  for(const width of [1280,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).focus();for(const key of ['Tab','Shift+Tab']){await page.keyboard.press(key);assert.equal(await dialog().evaluate(el=>el.contains(document.activeElement)),true);}}
  const longRow=panel().locator('.evidence-row').filter({hasText:longName});await longRow.getByRole('button',{name:'Xóa minh chứng',exact:true}).click();await panel().getByLabel('Lý do xóa minh chứng',{exact:true}).fill('Dọn tên dài smoke');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await dialog().evaluate(el=>el.contains(document.activeElement)),true);
  if(process.env.EVIDENCE_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.EVIDENCE_ARTIFACT_DIR,'evidence-mobile.png'),fullPage:true});
  await close();stage='late target response';let release,ready,done;const wait=new Promise(r=>release=r),arrived=new Promise(r=>ready=r),finished=new Promise(r=>done=r);await page.route(route,async r=>{if(r.request().method()==='GET'){const response=await r.fetch().catch(()=>null);ready();await wait;if(response)await r.fulfill({response}).catch(()=>{});done();}else await r.continue();});
  await page.locator('.task-row').filter({hasText:'EV-TASK'}).getByRole('button',{name:'Xem chi tiết',exact:true}).click();await arrived;await dialog().waitFor();await close();await openTask('EV-OTHER');release();await finished;await page.unroute(route);assert.equal(await panel().locator('.evidence-row').count(),0);await close();
  stage='late preview URL cleanup';let releaseImage,readyImage,doneImage;const waitImage=new Promise(r=>releaseImage=r),arrivedImage=new Promise(r=>readyImage=r),finishedImage=new Promise(r=>doneImage=r);const previewRoute=`**/projects/${project.id}/evidence/*/preview`;
  await page.route(previewRoute,async r=>{const response=await r.fetch().catch(()=>null);readyImage();await waitImage;if(response)await r.fulfill({response}).catch(()=>{});doneImage();});await openTask('EV-TASK');await arrivedImage;await close();await openTask('EV-OTHER');releaseImage();await finishedImage;await page.unroute(previewRoute);assert.equal(await page.evaluate(()=>window.__evidenceUrls.size),0);await close();
  stage='two roles/Item/Issue';if(techToken){await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await signIn('TECHNICIAN');await section('Công việc');await openTask('EV-TASK');assert.equal(await panel().getByRole('button',{name:'Sửa chú thích',exact:true}).count(),0);await choose('tech.png','image/png',png);await upload();await close();
  await request(techToken,'POST',`${base}/tasks/${task.id}/start`);await request(techToken,'POST',`${base}/tasks/${task.id}/submit`,{completionNote:'Smoke hoàn thành'});
  await page.reload();await page.locator('.project-row').filter({hasText:code}).click();await section('Công việc');await openTask('EV-TASK');assert.equal(await panel().getByLabel('File minh chứng').count(),0);await close();
  assert.equal((await fetch(api+base+`/inspections/${sheet.id}/items/${item.id}/evidence`,{headers:{Authorization:'Bearer '+techToken}})).status,403);}
  await page.getByRole('button',{name:'Về tổng quan',exact:true}).click();await section('Kiểm tra');if(!techToken)await page.getByRole('button',{name:'Lỗi khắc phục',exact:true}).click();await page.locator('.inspection-issue').getByRole('button',{name:/Lỗi thử minh chứng/}).click();await settled();await choose('issue.png','image/png',png);await upload();await close();
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await signIn('MANAGER');await section('Kiểm tra');await page.locator('.inspection-sheet').filter({hasText:'EV-SHEET'}).click();await dialog().getByRole('button',{name:new RegExp('Minh chứng '+item.code)}).click();await settled();await choose('item.pdf','application/pdf',Buffer.from('%PDF-1.4\nDemo\n%%EOF'));await upload();await close();
  stage='Item PASS lock';const passItem=sheet.items[1];await request(managerToken,'PUT',`${base}/inspections/${sheet.id}/items/${passItem.id}/result`,{expectedVersion:passItem.version,result:'PASS',note:'Smoke trạng thái khóa'});
  await page.getByRole('button',{name:'Về tổng quan',exact:true}).click();await section('Kiểm tra');await page.locator('.inspection-sheet').filter({hasText:'EV-SHEET'}).click();await dialog().getByRole('button',{name:new RegExp('Minh chứng '+passItem.code)}).click();await settled();assert.equal(await panel().getByLabel('File minh chứng').count(),0);await close();
  const technicians=await request(managerToken,'GET','/users/technicians'),other=technicians.find(u=>u.id!==tech.id);
  if(other&&techToken){await request(managerToken,'PATCH',`${base}/tasks/${task2.id}`,{assigneeId:other.id});assert.equal((await fetch(api+base+`/tasks/${task2.id}/evidence`,{headers:{Authorization:'Bearer '+techToken}})).status,404);console.log('PASS ownership revoked after reassignment');}else console.log('LIMIT reassignment ownership not tested: credentials or second active account unavailable');
  assert.deepEqual(errors,[]);console.log('PASS evidence MANAGER browser/API: PNG/JPEG/PDF, download/preview, caption null, soft delete, lost-response retry, GET failure, real 409 draft/version, late target/preview URL cleanup, Item/Issue/PASS lock and 390px');if(techToken)console.log('PASS TECHNICIAN browser, state lock and reload');
  }
  if(techToken) {
   stage='extended technician smoke';
   const list=target=>request(managerToken,'GET',base+'/'+target), taskTarget=targets[0],issueTarget=targets[3];
   const apiUpload=async(token,target,name,bytes=png,mime='image/png',expected=201)=>{const f=new FormData();f.append('file',new Blob([bytes],{type:mime}),name);f.append('caption','Smoke extended');const r=await fetch(api+base+'/'+target,{method:'POST',headers:{Authorization:'Bearer '+token,'Idempotency-Key':randomUUID()},body:f});assert.equal(r.status,expected,'upload validation/lock');if(expected!==201)return null;const row=await r.json();createdEvidence.add(row.id);return row;};
   const content=async(token,row,expected=200)=>{const r=await fetch(api+base+'/evidence/'+row.id+'/content',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,expected);if(expected===200)assert.equal((await r.arrayBuffer()).byteLength,row.sizeBytes);};
   const change=async(token,row,status)=>{await request(token,'PATCH',base+'/evidence/'+row.id,{expectedVersion:row.version,caption:'Forbidden'},status);await request(token,'DELETE',base+'/evidence/'+row.id,{expectedVersion:row.version,reason:'Smoke permission check'},status);};
   const switchRole=async role=>{await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await signIn(role);};
   const enterTask=async()=>{await page.reload();await page.locator('.project-row').filter({hasText:code}).click();await section('Công việc');await openTask('EV-TASK');};
   const enterIssue=async()=>{await page.reload();await page.locator('.project-row').filter({hasText:code}).click();await section('Kiểm tra');const tab=page.getByRole('button',{name:'Lỗi khắc phục',exact:true});if(await tab.count())await tab.click();await page.locator('.inspection-issue').getByRole('button',{name:/Lỗi thử minh chứng/}).click();await settled();};
   const assertReadonly=async()=>{assert.equal(await panel().getByLabel('File minh chứng').count(),0);assert.equal(await panel().getByRole('button',{name:'Sửa chú thích',exact:true}).count(),0);assert.equal(await panel().getByRole('button',{name:'Xóa minh chứng',exact:true}).count(),0);};
   const lock=async(target,enter)=>{for(const role of ['MANAGER','TECHNICIAN']){const token=role==='MANAGER'?managerToken:techToken;await apiUpload(token,target,'locked.png',png,'image/png',409);const rows=await list(target);assert.ok(rows.length>0,'Lock cases need undeleted evidence');for(const row of rows){await content(token,row);await change(token,row,409);}await switchRole(role);await enter();await assertReadonly();const download=page.waitForEvent('download');await panel().getByRole('button',{name:'Tải xuống',exact:true}).first().click();await download;await close();}};
   if(!resumeLocks) {
   await lock(taskTarget,enterTask);console.log('PASS undeleted Task SUBMITTED evidence: both roles PATCH/DELETE409, content/download200 + UI lock');
   await request(managerToken,'POST',`${base}/tasks/${task.id}/return`,{reason:'Smoke bổ sung evidence'});
   await enterTask();
   for(const [name,mime,bytes] of [['tech.png','image/png',png],['tech.jpg','image/jpeg',Buffer.from(jpeg,'base64')],['tech.pdf','application/pdf',Buffer.from('%PDF-1.4\nDemo\n%%EOF')]]){
    const filename='extended-'+name;await choose(filename,mime,bytes);await upload();let row=(await list(taskTarget)).find(r=>r.originalName===filename);assert.equal(row.uploadedBy.id,tech.id);await content(techToken,row);
    const element=panel().locator('.evidence-row').filter({hasText:filename});if(mime.startsWith('image/'))await element.locator('img').waitFor();else await element.getByText('PDF',{exact:true}).waitFor();const download=page.waitForEvent('download');await element.getByRole('button',{name:'Tải xuống',exact:true}).click();assert.equal((await download).suggestedFilename(),filename);
    await element.getByRole('button',{name:'Sửa chú thích',exact:true}).click();await panel().getByLabel('Chú thích minh chứng',{exact:true}).fill('tech note');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();await element.getByRole('button',{name:'Sửa chú thích',exact:true}).click();await panel().getByLabel('Chú thích minh chứng',{exact:true}).fill('');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();row=(await list(taskTarget)).find(r=>r.id===row.id);assert.equal(row.caption,null);
    await element.getByRole('button',{name:'Xóa minh chứng',exact:true}).click();await panel().getByLabel('Lý do xóa minh chứng',{exact:true}).fill('Dọn extended smoke');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();await content(techToken,row,404);
   }
   const mgrRow=(await list(taskTarget)).find(r=>r.uploadedBy.id!==tech.id);await change(techToken,mgrRow,403);assert.equal(await panel().locator('.evidence-row').filter({hasText:mgrRow.originalName}).getByRole('button',{name:'Sửa chú thích',exact:true}).count(),0);
   await apiUpload(techToken,taskTarget,'bad.txt',Buffer.from('bad'),'text/plain',415);await apiUpload(techToken,taskTarget,'oversize.png',Buffer.concat([png,Buffer.alloc(10*1024*1024)]),'image/png',413);
   await close();await request(techToken,'POST',`${base}/tasks/${task.id}/start`);await request(techToken,'POST',`${base}/tasks/${task.id}/submit`,{completionNote:'Extended smoke gửi lại'});await request(managerToken,'POST',`${base}/tasks/${task.id}/approve`);await lock(taskTarget,enterTask);console.log('PASS TECHNICIAN JPEG/PNG/PDF CRUD + manager403 + API413/415; Task RETURNED writable, APPROVED existing files read-only');
   await enterIssue();const ownIssue=(await list(issueTarget)).find(r=>r.uploadedBy.id===tech.id);assert.ok(ownIssue);await panel().locator('.evidence-row').filter({hasText:ownIssue.originalName}).getByRole('button',{name:'Sửa chú thích',exact:true}).click();await panel().getByLabel('Chú thích minh chứng',{exact:true}).fill('Issue technician note');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();await close();
   }
   if(resumeLocks){await lock(taskTarget,enterTask);console.log('PASS resumed Task APPROVED undeleted content/download; both roles API409/UI lock');}
   let current=await request(techToken,'GET',`${base}/issues/${issue.id}`);
   if(current.status!=='CLOSED') {
   if(!resumeLocks){current=await request(techToken,'POST',`${base}/issues/${issue.id}/start`,{expectedVersion:current.version});current=await request(techToken,'POST',`${base}/issues/${issue.id}/resolve`,{expectedVersion:current.version,resolutionNote:'Extended smoke đã sửa'});}assert.equal(current.item.result,'FAIL');await lock(issueTarget,enterIssue);
   current=await request(managerToken,'POST',`${base}/issues/${issue.id}/recheck`,{expectedVersion:current.version,expectedItemVersion:current.item.version,result:'FAIL',note:'Extended smoke kiểm tra',reason:'Cần bổ sung'});assert.equal(current.status,'OPEN');
   const reopened=await apiUpload(techToken,issueTarget,'reopened.png');await request(techToken,'DELETE',base+'/evidence/'+reopened.id,{expectedVersion:reopened.version,reason:'Dọn ca reopened'},204);
   current=await request(techToken,'POST',`${base}/issues/${issue.id}/start`,{expectedVersion:current.version});current=await request(techToken,'POST',`${base}/issues/${issue.id}/resolve`,{expectedVersion:current.version,resolutionNote:'Extended smoke sửa lại'});current=await request(managerToken,'POST',`${base}/issues/${issue.id}/recheck`,{expectedVersion:current.version,expectedItemVersion:current.item.version,result:'PASS',note:'Extended smoke đạt'});assert.equal(current.status,'CLOSED');assert.equal(current.item.result,'PASS');await lock(issueTarget,enterIssue);console.log('PASS Issue RESOLVED/CLOSED undeleted files both roles content/download + PATCH/DELETE409, recheck FAIL/reopen then PASS; Item snapshot integration');
   } else {await lock(issueTarget,enterIssue);console.log('PASS resumed Issue CLOSED undeleted files both roles content/download + PATCH/DELETE409 and UI lock');}
   await request(techToken,'GET',base+'/'+targets[2],undefined,403);
   const itemRow=(await list(targets[2]))[0];if(itemRow)for(const suffix of ['content','preview'])assert.equal((await fetch(api+base+'/evidence/'+itemRow.id+'/'+suffix,{headers:{Authorization:'Bearer '+techToken}})).status,403);
   if(!(await request(managerToken,'GET','/users/technicians')).some(u=>u.id!==tech.id))console.log('LIMIT only one active TECHNICIAN; old/new assignee transfer not verified, no accounts changed');
   stage='TECHNICIAN retry on separate assigned task';
   await enterTask();await close();await openTask('EV-OTHER');const otherTarget=targets[1],otherRoute=`**${base}/${otherTarget}`;assert.equal((await list(otherTarget)).length,0,'Retry fixture must have no visible existing files');let retryKeys=[];
   await page.route(otherRoute,async r=>{if(r.request().method()==='POST'){retryKeys.push(r.request().headers()['idempotency-key']);await r.fetch();await r.abort('failed');}else await r.continue();});
   await choose('tech-retry.png','image/png',png);await upload();await panel().getByRole('alert').waitFor();await page.unroute(otherRoute);
   await page.route(otherRoute,async r=>{if(r.request().method()==='POST')retryKeys.push(r.request().headers()['idempotency-key']);await r.continue();});await upload();assert.equal(retryKeys.length,2);assert.equal(retryKeys[0],retryKeys[1]);assert.equal((await list(otherTarget)).length,1);await page.unroute(otherRoute);
   let techPosts=0,techGetFail=false;await page.route(otherRoute,async r=>{if(r.request().method()==='POST'){techPosts++;await r.continue();}else if(techGetFail)await r.fulfill({status:503,json:{message:'Injected GET failure'}});else await r.continue();});await choose('tech-get-error.png','image/png',png);techGetFail=true;await upload();assert.equal(await panel().locator('.evidence-row').count(),0);assert.equal(await panel().getByLabel('File minh chứng').count(),0);techGetFail=false;await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).click();await settled();assert.equal(techPosts,1);assert.equal((await list(otherTarget)).length,2);await page.unroute(otherRoute);await close();
   for(const row of await list(otherTarget)){assert.ok(createdEvidence.has(row.id),'Never clean evidence from another run/user');await request(techToken,'DELETE',base+'/evidence/'+row.id,{expectedVersion:row.version,reason:'Dọn ca retry riêng'},204);}
   console.log('PASS TECHNICIAN response-loss same key one row; POST success/GET503 only GET retry; assigned task cleanup');
   stage='late Project response and keyboard';
   const alternative=(await request(managerToken,'GET','/projects')).find(p=>p.code.startsWith('EVIDENCE-UI-')&&p.id!==project.id);assert.ok(alternative);
   const currentRoute=`**${base}/${taskTarget}`;let releaseProject,signalProject,doneProject;const blocked=new Promise(r=>releaseProject=r),arrivedProject=new Promise(r=>signalProject=r),completedProject=new Promise(r=>doneProject=r);
   await page.route(currentRoute,async r=>{if(r.request().method()==='GET'){const response=await r.fetch();signalProject();await blocked;await r.fulfill({response}).catch(()=>{});doneProject();}else await r.continue();});
   stage='late GET arrival';await page.locator('.task-row').filter({hasText:'EV-TASK'}).getByRole('button',{name:'Xem chi tiết',exact:true}).click();await arrivedProject;assert.equal(await panel().getAttribute('aria-busy'),'true');stage='Escape loading dialog';await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(await page.evaluate(()=>window.__evidenceUrls.size),0);
   stage='select alternative Project';await page.getByRole('button',{name:/Danh sách công trình/}).click();await page.locator('.project-row').filter({hasText:alternative.code}).click();await page.locator('.overview-links').waitFor();stage='release late Project GET';releaseProject();await completedProject;await page.unroute(currentRoute);assert.equal(await panel().count(),0);assert.equal(await page.locator('.overview-links').getByRole('button').count(),6);
   stage='return trial Project';await page.getByRole('button',{name:/Danh sách công trình/}).click();await page.locator('.project-row').filter({hasText:code}).click();await section('Công việc');await openTask('EV-TASK');await panel().locator('img').first().waitFor();stage='keyboard both viewports';
   for(const width of [1280,390]){await page.setViewportSize({width,height:844});const bounds=await dialog().boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);for(const key of ['Tab','Shift+Tab']){await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});await page.keyboard.press(key);assert.equal(await dialog().evaluate(el=>el.contains(document.activeElement)),true);}}
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));assert.equal(await page.evaluate(()=>window.__evidenceUrls.size),0);assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Xem chi tiết');
   await page.getByRole('button',{name:'Về tổng quan',exact:true}).click();await page.locator('.overview-links').waitFor();assert.equal(await page.locator('.overview-links').getByRole('button').count(),6);assert.deepEqual(errors,[]);
   console.log('PASS close loading dialog/Escape, late Project GET discarded, object URLs revoked, Tab/Shift+Tab trap/return focus, desktop/390px dialog and six-card overview');
  }
 }finally{
  try {
  if(page&&process.env.EVIDENCE_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.EVIDENCE_ARTIFACT_DIR,'evidence-last.png'),fullPage:true}).catch(()=>{});
  if(created){let deleted=0,locked=0,preserved=0;for(const target of targets){const rows=await request(managerToken,'GET',base+'/'+target);for(const row of rows){if(!createdEvidence.has(row.id)){preserved++;continue;}const r=await fetch(api+base+'/evidence/'+row.id,{method:'DELETE',headers:{Authorization:'Bearer '+managerToken,'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:row.version,reason:'Dọn fixture smoke riêng'})});if(r.status===204)deleted++;else if(r.status===409)locked++;else throw new Error('Smoke cleanup failed');}}
   console.log(`Trial Project ${code}: remains (no DELETE Project/Task/Inspection API); soft-deleted ${deleted} evidence, locked ${locked}, preserved from earlier runs ${preserved}; disk files retained by design.`);
  }
  } finally { await browser.close(); }
 }
}
run().catch(error=>{console.error(`Evidence smoke failed (${error.name}) at ${stage}${created?'; trial Project '+code+' may remain':''}`);process.exitCode=1;});
