// Optional real local API smoke; only adds uniquely labelled records to an existing trial Project.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const local=require('dotenv').parse(fs.readFileSync(path.resolve(__dirname,'../../backend/.env')));
const api=process.env.ACCEPTANCE_API_URL||'http://localhost:3000';
const trial=process.env.ACCEPTANCE_TRIAL_CODE||'EVIDENCE-UI-F47A47EE';
if(!/^EVIDENCE-UI-[A-Z0-9]+$/.test(trial))throw Error('Explicit trial Project required');
let stage='health';const created={projectCode:trial,inspectionIds:[],taskIds:[],acceptanceIds:[],evidenceIds:[]};let token,base;
async function request(t,method,url,body,status=200){const r=await fetch(api+url,{method,headers:{...(t?{Authorization:'Bearer '+t}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status,`${method} ${url}`);return status===204?null:r.json();}
async function run(){
 assert.equal((await request(null,'GET','/health')).database,'connected');stage='authentication';
 const login=role=>request(null,'POST','/auth/login',{email:process.env[`DEMO_${role}_EMAIL`]||local[`DEMO_${role}_EMAIL`]||(role==='MANAGER'?'manager.demo@example.local':'technician.demo@example.local'),password:process.env[`DEMO_${role}_PASSWORD`]||local[`DEMO_${role}_PASSWORD`]},201);
 token=(await login('MANAGER')).accessToken;const techToken=(await login('TECHNICIAN')).accessToken;
 const tech=await request(techToken,'GET','/auth/me');
 const project=(await request(token,'GET','/projects')).find(p=>p.code===trial);assert.ok(project);assert.equal(project.name,'Smoke minh chứng riêng');base=`/projects/${project.id}`;
 stage='contract';await request(token,'GET',base+'/acceptances');
 const system=(await request(token,'GET',base+'/systems')).find(s=>s.code==='LAN');assert.ok(system);
 const template=(await request(token,'GET','/checklist-templates?category=LAN'))[0];assert.ok(template);
 const suffix=randomUUID().slice(0,8).toUpperCase();stage='trial creation';
 const sheet=await request(token,'POST',base+'/inspections',{code:'AC-S-'+suffix,title:'Acceptance trial '+suffix,systemId:system.id,templateId:template.id},201);created.inspectionIds.push(sheet.id);
 const task=await request(token,'POST',base+'/tasks',{code:'AC-T-'+suffix,title:'Acceptance evidence trial',systemId:system.id,assigneeId:tech.id},201);created.taskIds.push(task.id);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'acceptance-trial.png');
 const response=await fetch(api+base+`/tasks/${task.id}/evidence`,{method:'POST',headers:{Authorization:'Bearer '+token,'Idempotency-Key':randomUUID()},body:form});assert.equal(response.status,201);const evidence=await response.json();created.evidenceIds.push(evidence.id);
 const draft=await request(token,'POST',base+'/acceptances',{code:'AC-A-'+suffix,title:'Acceptance trial',systemId:system.id,inspectionIds:[],evidenceIds:[]},201);created.acceptanceIds.push(draft.id);
 const url=base+'/acceptances/'+draft.id;
 let ready=await request(token,'GET',url+'/readiness');assert.equal(ready.eligible,false);assert.ok(ready.blockers.includes('NO_INSPECTIONS'));
 await request(token,'PATCH',url,{expectedVersion:1,inspectionIds:[sheet.id],evidenceIds:[evidence.id]});
 ready=await request(token,'GET',url+'/readiness');assert.equal(ready.eligible,false);const stale=ready.sourceFingerprint;
 for(const item of sheet.items)await request(token,'PUT',`${base}/inspections/${sheet.id}/items/${item.id}/result`,{expectedVersion:item.version,result:'PASS',note:'Acceptance smoke PASS'});
 stage='stale fingerprint/version';await request(token,'POST',url+'/confirm',{expectedVersion:1,expectedSourceFingerprint:stale},409);await request(token,'POST',url+'/confirm',{expectedVersion:2,expectedSourceFingerprint:stale},409);
 ready=await request(token,'GET',url+'/readiness');assert.equal(ready.eligible,true);
 const confirmed=await request(token,'POST',url+'/confirm',{expectedVersion:2,expectedSourceFingerprint:ready.sourceFingerprint});assert.equal(confirmed.status,'CONFIRMED');
 stage='snapshot and pin';await request(token,'DELETE',base+'/evidence/'+evidence.id,{expectedVersion:1,reason:'Acceptance smoke source soft delete'},204);
 const pinned=await fetch(api+url+`/files/${evidence.id}/content`,{headers:{Authorization:'Bearer '+token}});assert.equal(pinned.status,200);assert.equal(createHash('sha256').update(Buffer.from(await pinned.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 await request(token,'PUT',`${base}/inspections/${sheet.id}/items/${sheet.items[0].id}/result`,{expectedVersion:2,result:'NOT_CHECKED'});
 assert.deepEqual((await request(token,'GET',url)).snapshot,confirmed.snapshot);
 stage='replacement';const replacement=await request(token,'POST',url+'/replacement',{code:'AC-R-'+suffix,title:'Replacement trial',reason:'New explicit selection',inspectionIds:[sheet.id],evidenceIds:[]},201);created.acceptanceIds.push(replacement.id);
 assert.equal((await request(token,'GET',url)).replacedById,null);assert.deepEqual(replacement.evidenceIds,[]);
 await request(token,'PUT',`${base}/inspections/${sheet.id}/items/${sheet.items[0].id}/result`,{expectedVersion:3,result:'PASS'});
 const repUrl=base+'/acceptances/'+replacement.id,r=await request(token,'GET',repUrl+'/readiness');await request(token,'POST',repUrl+'/confirm',{expectedVersion:1,expectedSourceFingerprint:r.sourceFingerprint});assert.equal((await request(token,'GET',url)).replacedById,replacement.id);
 stage='technician summary';const summary=await request(techToken,'GET',url);assert.equal('snapshot' in summary,false);assert.equal('note' in summary,false);assert.equal('evidenceIds' in summary,false);
 await request(techToken,'GET',url+`/files/${evidence.id}/content`,undefined,403);await request(techToken,'POST',repUrl+'/replacement',{code:'NO',title:'No',reason:'No',inspectionIds:[],evidenceIds:[]},403);
 console.log('PASS real API acceptance workflow, stale versions/fingerprint, immutable snapshot, soft-deleted pin, explicit replacement, Technician whitelist/403');console.log('REMAINS '+JSON.stringify(created)+'; 1 soft-deleted evidence metadata/disk pinned; no DELETE acceptance/inspection API');
}
run().catch(()=>{console.error('FAIL stage='+stage+'; '+JSON.stringify(created)+'; no secrets logged');process.exitCode=1;});
