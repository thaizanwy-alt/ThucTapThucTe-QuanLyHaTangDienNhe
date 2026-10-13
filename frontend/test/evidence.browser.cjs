// Optional external Playwright/Chrome; only a uniquely named trial Project is written.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const local=require('dotenv').parse(fs.readFileSync(path.resolve(__dirname,'../../backend/.env')));
const api=process.env.EVIDENCE_API_URL||'http://localhost:3000',web=process.env.EVIDENCE_WEB_URL||'http://localhost:5173';
const code='EVIDENCE-UI-'+randomUUID().slice(0,8).toUpperCase();
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
let stage='environment',base,project,managerToken,created=false;
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
  stage='fixture';project=await request(managerToken,'POST','/projects',{code,name:'Smoke minh chứng riêng',status:'IN_PROGRESS'},201);created=true;base=`/projects/${project.id}`;console.log('Trial Project '+code);
  const system=await request(managerToken,'POST',base+'/systems',{code:'LAN',name:'LAN thử',category:'LAN'},201);
  const task=await request(managerToken,'POST',base+'/tasks',{code:'EV-TASK',title:'Việc thử minh chứng',systemId:system.id,assigneeId:tech.id},201);
  const task2=await request(managerToken,'POST',base+'/tasks',{code:'EV-OTHER',title:'Việc đổi target',systemId:system.id,assigneeId:tech.id},201);
  const template=(await request(managerToken,'GET','/checklist-templates?category=LAN'))[0];
  const sheet=await request(managerToken,'POST',base+'/inspections',{code:'EV-SHEET',title:'Phiếu thử minh chứng',systemId:system.id,templateId:template.id},201);
  const item=await request(managerToken,'PUT',`${base}/inspections/${sheet.id}/items/${sheet.items[0].id}/result`,{expectedVersion:1,result:'FAIL',issue:{description:'Lỗi thử minh chứng',assigneeId:tech.id}});
  const issue=item.activeIssue;
  targets=[`tasks/${task.id}/evidence`,`tasks/${task2.id}/evidence`,`inspections/${sheet.id}/items/${item.id}/evidence`,`issues/${issue.id}/evidence`];
  page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',()=>errors.push('runtime'));
  await page.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__evidenceUrls=new Set();URL.createObjectURL=blob=>{const url=create(blob);window.__evidenceUrls.add(url);return url;};URL.revokeObjectURL=url=>{window.__evidenceUrls.delete(url);revoke(url);};});
  const signIn=async role=>{await page.goto(web);await page.getByLabel('Email',{exact:true}).fill(credentials(role).email);await page.getByLabel('Mật khẩu',{exact:true}).fill(credentials(role).password);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.locator('.project-row').filter({hasText:code}).click();};
  const section=async name=>{await page.locator('.overview-links').getByRole('button',{name:new RegExp(name)}).click();};
  const dialog=()=>page.getByRole('dialog'),panel=()=>page.locator('.evidence-panel');
  const settled=async()=>{await panel().waitFor();await page.waitForFunction(()=>document.querySelector('.evidence-panel')?.getAttribute('aria-busy')==='false');};
  const openTask=async which=>{await page.locator('.task-row').filter({hasText:which}).getByRole('button',{name:'Xem chi tiết',exact:true}).click();await settled();};
  const close=async()=>{await dialog().getByRole('button',{name:'Đóng',exact:true}).click();await page.waitForFunction(()=>window.__evidenceUrls.size===0);};
  const choose=async(name,mimeType,buffer)=>panel().getByLabel('File minh chứng',{exact:true}).setInputFiles({name,mimeType,buffer});
  const upload=async()=>{await panel().getByRole('button',{name:'Tải minh chứng lên',exact:true}).click();await settled();};
  await signIn('MANAGER');await section('Công việc');await openTask('EV-TASK');
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
  stage='JPEG/PDF and GET failure';const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;return c.toDataURL('image/jpeg').split(',')[1];});
  await choose('proof.jpg','image/jpeg',Buffer.from(jpeg,'base64'));await upload();assert.equal(await panel().locator('.evidence-row').count(),1);
  let posts=0,failGet=false;await page.route(route,async r=>{if(r.request().method()==='POST'){posts++;await r.continue();}else if(failGet)await r.fulfill({status:503,json:{message:'Injected GET failure'}});else await r.continue();});
  await choose('proof.pdf','application/pdf',Buffer.from('%PDF-1.4\nDemo\n%%EOF'));failGet=true;await upload();assert.equal(await panel().locator('.evidence-row').count(),0);assert.equal(await panel().getByLabel('File minh chứng').count(),0);
  failGet=false;await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).click();await settled();assert.equal(posts,1);assert.equal(await panel().locator('.evidence-row').count(),2);await page.unroute(route);
  stage='real stale version';const first=(await request(managerToken,'GET',base+'/tasks/'+task.id+'/evidence'))[0];
  await panel().getByRole('button',{name:'Sửa chú thích',exact:true}).first().click();await panel().getByLabel('Chú thích minh chứng',{exact:true}).fill('Draft giữ khi 409');
  await request(managerToken,'PATCH',`${base}/evidence/${first.id}`,{expectedVersion:first.version,caption:'Thay đổi từ phiên khác'});
  await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();await panel().getByRole('alert').waitFor();assert.equal(await panel().getByLabel('Chú thích minh chứng',{exact:true}).inputValue(),'Draft giữ khi 409');
  await panel().getByRole('button',{name:'Tải lại minh chứng',exact:true}).click();await settled();assert.equal(await panel().getByLabel('Chú thích minh chứng',{exact:true}).inputValue(),'Draft giữ khi 409');await panel().getByRole('button',{name:'Xác nhận',exact:true}).click();await settled();
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
 }finally{
  try {
  if(page&&process.env.EVIDENCE_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.EVIDENCE_ARTIFACT_DIR,'evidence-last.png'),fullPage:true}).catch(()=>{});
  if(created){let deleted=0,locked=0;for(const target of targets){const rows=await request(managerToken,'GET',base+'/'+target);for(const row of rows){const r=await fetch(api+base+'/evidence/'+row.id,{method:'DELETE',headers:{Authorization:'Bearer '+managerToken,'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:row.version,reason:'Dọn fixture smoke riêng'})});if(r.status===204)deleted++;else if(r.status===409)locked++;else throw new Error('Smoke cleanup failed');}}
   console.log(`Trial Project ${code}: remains (no DELETE Project/Task/Inspection API); soft-deleted ${deleted} evidence, locked ${locked}; disk files retained by design.`);
  }
  } finally { await browser.close(); }
 }
}
run().catch(error=>{console.error(`Evidence smoke failed (${error.name}) at ${stage}${created?'; trial Project '+code+' may remain':''}`);process.exitCode=1;});
