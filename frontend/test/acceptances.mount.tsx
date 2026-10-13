// Vite browser harness: mounts the real panel. All HTTP is intercepted; no DB writes.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AcceptancePanel from '../src/AcceptancePanel';
import '../src/style.css';

const host=document.getElementById('mount')!;
const result=document.getElementById('result')!;
const button=document.getElementById('run') as HTMLButtonElement;
function assert(value:unknown,message:string){if(!value)throw Error(message);}
const row={id:'acceptance',projectId:'project',systemId:'system',code:'DRAFT-01',title:'Regression',status:'DRAFT',version:1,inspectionIds:['sheet-a','sheet-b'],evidenceIds:['item-a','issue-b','task-file'],snapshot:null};
const sheets=['a','b'].map(k=>({id:'sheet-'+k,systemId:'system',code:'SHEET-'+k.toUpperCase(),title:'Sheet',passed:true,items:[{id:'item-'+k,result:'PASS',issues:[{id:'issue-'+k,status:'CLOSED',assigneeId:'tech'}]}]}));
const files=[{id:'item-a',inspectionItemId:'item-a',taskId:null,issueId:null,originalName:'Item A'}, {id:'issue-b',inspectionItemId:null,taskId:null,issueId:'issue-b',originalName:'Issue B'}, {id:'task-file',taskId:'task',inspectionItemId:null,issueId:null,originalName:'Task'}, {id:'not-selected',inspectionItemId:'item-b',taskId:null,issueId:null,originalName:'Unselected'}];
function buttons(text:string){return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(b=>b.textContent===text);}
async function click(text:string){const b=buttons(text)[0];assert(b,'Missing button '+text);await act(async()=>{b.click();});}
button.onclick=async()=>{
 button.disabled=true;result.textContent='Đang chạy…';
 const original=window.fetch;let resolveReady:((r:Response)=>void)|null=null;let payload:any=null;let requests=0;
 const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 window.fetch=async(input,options)=>{
  requests++;const url=String(input);
  if(url.endsWith('/readiness'))return new Promise<Response>(resolve=>{resolveReady=resolve;});
  if(options?.method==='PATCH'){payload=JSON.parse(String(options.body));return json({...row,...payload});}
  if(options?.method&&options.method!=='GET')throw Error('Unexpected write blocked');
  if(url.endsWith('/acceptances'))return json([row]);
  if(url.endsWith('/acceptances/acceptance'))return json(row);
  if(url.endsWith('/inspections'))return json(sheets);
  if(url.endsWith('/tasks'))return json([{id:'task',systemId:'system',status:'ASSIGNED',assigneeId:'tech'}]);
  if(url.endsWith('/evidence'))return json(files.filter(f=>f.taskId?url.includes('/tasks/'+f.taskId+'/'):f.issueId?url.includes('/issues/'+f.issueId+'/'):url.includes('/items/'+f.inspectionItemId+'/')));
  throw Error('Unexpected request blocked: '+url);
 };
 const root=createRoot(host);
 const render=async(projectId='project')=>act(async()=>{root.render(<AcceptancePanel token="fixture-not-a-jwt" user={{id:'manager',email:'manager@example.local',role:'MANAGER'} as any} projectId={projectId} systems={[{id:'system',code:'LAN',name:'LAN'} as any]} onSignOut={()=>{throw Error('Unexpected logout');}}/>);});
 const release=async()=>{assert(resolveReady,'Readiness not pending');await act(async()=>{resolveReady!(json({eligible:true,blockers:[],version:1,sourceFingerprint:'fixture'}));});resolveReady=null;};
 try{
  await render();await click('Xem hồ sơ');await click('Tải lại readiness');
  assert(buttons('Sửa nháp')[0].disabled,'Edit must be disabled while readiness pending');
  await act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="Đóng"]')!.click();});
  assert(host.querySelectorAll('[role="dialog"]').length===0,'Close removes dialog');
  await click('Xem hồ sơ');await click('Sửa nháp');await release();
  assert(host.querySelectorAll('[role="dialog"]').length===1,'Late readiness cannot stack dialogs');
  assert(host.querySelector('form'),'Editor remains open after late readiness');
  const dialog=host.querySelector<HTMLElement>('[role="dialog"]')!;
  assert(dialog.contains(document.activeElement),'Focus stays in the editor');
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));});
  assert(dialog.contains(document.activeElement),'No competing focus trap after late readiness');
  const sheetA=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.includes('SHEET-A'))!.querySelector<HTMLInputElement>('input')!;
  await act(async()=>{sheetA.click();});
  await click('Lưu nháp');
  assert(JSON.stringify(payload.inspectionIds)===JSON.stringify(['sheet-b']),'Only sheet A removed');
  assert(JSON.stringify(payload.evidenceIds)===JSON.stringify(['issue-b','task-file']),'Keep B Issue/Task evidence; do not select new evidence');
  await click('Xem hồ sơ');await click('Tải lại readiness');await render('another-project');await release();
  assert(host.querySelectorAll('[role="dialog"]').length===0,'Project change rejects late readiness');
  result.textContent='PASS 3/3 React mounted regressions: delayed readiness close → edit, evidence payload, Project change. '+requests+' intercepted requests; 0 real API/DB requests.';
 }catch(e){result.textContent='FAIL '+(e instanceof Error?e.message:String(e));}
 finally{await act(async()=>{root.unmount();});window.fetch=original;button.disabled=false;}
};
