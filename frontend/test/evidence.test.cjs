const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(name, transform = s => s) {
  const file = path.resolve(__dirname, '../src/' + name), m = new Module(file, module);
  m.paths = module.paths;
  m._compile(ts.transpileModule(transform(fs.readFileSync(file, 'utf8')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
const state = load('evidence-state.ts');
const manager = { id: 'manager', role: 'MANAGER' }, tech = { id: 'tech', role: 'TECHNICIAN' };
test('evidence permissions match target/owner and locked states', () => {
  for (const kind of ['task','issue']) {
    const target = {kind,id:'a',assigneeId:'tech',status:kind==='task'?'IN_PROGRESS':'OPEN'};
    assert.deepEqual(state.evidencePermissions(tech,target),{read:true,write:true});
    assert.equal(state.evidencePermissions({...tech,id:'other'},target).read,false);
    for (const status of kind==='task'?['SUBMITTED','APPROVED']:['RESOLVED','CLOSED']) assert.deepEqual(state.evidencePermissions(manager,{...target,status}),{read:true,write:false});
  }
  assert.deepEqual(state.evidencePermissions(tech,{kind:'item',status:'FAIL'}),{read:false,write:false});
  assert.deepEqual(state.evidencePermissions(manager,{kind:'item',status:'PASS'}),{read:true,write:false});
});
test('file type/size limits and caption normalization fingerprint', async () => {
  for (const [type,name] of [['image/jpeg','a.JPG'],['image/png','a.png'],['application/pdf','a.pdf']]) state.validateEvidenceFile({type,name,size:10*1024*1024},'');
  for (const file of [{type:'image/png',name:'a.png',size:0},{type:'image/png',name:'a.png',size:10485761},{type:'text/plain',name:'a.txt',size:1}]) assert.throws(()=>state.validateEvidenceFile(file,''));
  const file = new File(['hello'],'a.png',{type:'image/png'});
  assert.equal(await state.uploadFingerprint(file,' note '),await state.uploadFingerprint(file,'note'));
  assert.notEqual(await state.uploadFingerprint(file,'a'),await state.uploadFingerprint(file,'b'));
});
test('unknown upload retry reuses key; changed payload/new upload rotates it; scopes are isolated', () => {
  const first=state.uploadKey('task-a','same');assert.equal(state.uploadKey('task-a','same'),first);
  const changed=state.uploadKey('task-a','changed');assert.notEqual(changed,first);
  assert.notEqual(state.uploadKey('task-b','changed'),changed);
  state.clearUploadKey('task-a');assert.notEqual(state.uploadKey('task-a','changed'),changed);
});
test('request gate rejects late response after target/unmount; object URL cleanup is exact', () => {
  const gate=new state.EvidenceGate(),old=gate.begin(),next=gate.begin();assert.equal(gate.current(old),false);assert.equal(gate.current(next),true);gate.invalidate();assert.equal(gate.current(next),false);
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL,deleted=[];let serial=0;
  URL.createObjectURL=()=>`blob:${++serial}`;URL.revokeObjectURL=url=>deleted.push(url);
  try {const urls=new state.EvidenceUrls(),a=urls.create(new Blob()),b=urls.create(new Blob());urls.release(a);urls.clear();urls.release(b);assert.deepEqual(deleted,[a,b]);}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
});
test('API paths, multipart Bearer/key, nullable caption/version and Blob content match backend', async () => {
  const api=load('api/evidence.ts',s=>s.replace("import { ApiError, baseUrl } from './client';",'const baseUrl="http://example.invalid"; class ApiError extends Error {constructor(public status:number,message:string){super(message)}}'));
  const original=global.fetch,calls=[];
  global.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify([]),{status:200,headers:{'Content-Type':'application/json'}})};
  try {
    const target={kind:'task',id:'t',status:'ASSIGNED',assigneeId:'tech'};
    await api.uploadEvidence('runtime-value','p',target,new File(['x'],'a.png',{type:'image/png'}),' note ','retry-key');
    const c=calls[0];assert.equal(c.url,'http://example.invalid/projects/p/tasks/t/evidence');assert.equal(c.options.headers.get('Authorization'),'Bearer runtime-value');assert.equal(c.options.headers.get('Content-Type'),null);assert.equal(c.options.headers.get('Idempotency-Key'),'retry-key');assert.equal(c.options.body.get('caption'),'note');
    await api.updateEvidence('runtime-value','p',{id:'e',version:3},null);assert.deepEqual(JSON.parse(calls[1].options.body),{expectedVersion:3,caption:null});
    await api.deleteEvidence('runtime-value','p',{id:'e',version:4},' reason ');assert.deepEqual(JSON.parse(calls[2].options.body),{expectedVersion:4,reason:'reason'});
    assert.equal(api.evidencePath('p',{kind:'item',id:'i',inspectionId:'s'}),'/projects/p/inspections/s/items/i/evidence');
    assert.ok(await api.evidenceBlob('runtime-value','p','e',true) instanceof Blob);
    for (const status of [400,401,403,404,409,413,415,503]) {global.fetch=async()=>new Response('',{status});await assert.rejects(api.listEvidence('runtime-value','p',target),e=>e.status===status);}
  } finally {global.fetch=original;}
});
