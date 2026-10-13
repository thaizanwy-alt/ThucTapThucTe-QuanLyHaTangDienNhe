const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../src/acceptance-form.ts'),loaded=new Module(file,module);
loaded._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {selectionPayload,canConfirm,blockerLabel,AcceptanceGate,saveAcceptanceAndRefresh}=loaded.exports;
test('acceptance selection normalizes text, explicit empty replacement arrays; nullable note remains outside selection',()=>{
 assert.deepEqual(selectionPayload({code:' ac-01 ',title:' Title ',inspectionIds:[],evidenceIds:[]}),{code:'AC-01',title:'Title',inspectionIds:[],evidenceIds:[]});
 for(const code of ['', ' ', 'A/B'])assert.throws(()=>selectionPayload({code,title:'T',inspectionIds:[],evidenceIds:[]}));
 assert.throws(()=>selectionPayload({code:'A',title:' ',inspectionIds:[],evidenceIds:[]}));
 assert.deepEqual(selectionPayload({code:'A',title:'T',inspectionIds:['s','s'],evidenceIds:['e','e']}).evidenceIds,['e']);
});
test('confirmation requires manager, draft, eligible readiness and matching version',()=>{
 const row={status:'DRAFT',version:2},r={eligible:true,version:2};assert.equal(canConfirm(row,r,true),true);
 assert.equal(canConfirm(row,r,false),false);assert.equal(canConfirm({...row,status:'CONFIRMED'},r,true),false);
 assert.equal(canConfirm(row,null,true),false);assert.equal(canConfirm(row,{...r,eligible:false},true),false);assert.equal(canConfirm(row,{...r,version:1},true),false);
 assert.match(blockerLabel('NO_INSPECTIONS'),/Chưa chọn/);assert.match(blockerLabel('ITEM_NOT_PASS:item'),/item/);
});
test('request gate discards late target and Project responses',()=>{
 const gate=new AcceptanceGate(),old=gate.next(),fresh=gate.next();assert.equal(gate.current(old),false);assert.equal(gate.current(fresh),true);gate.next();assert.equal(gate.current(fresh),false);
});
test('saved write closes/hides before failed GET; retry is GET only; failed write retains draft',async()=>{
 const actions=[];const write=async()=>actions.push('POST'),close=()=>actions.push('close/hide'),get=async()=>{actions.push('GET');throw Error('GET unavailable');};
 assert.equal(await saveAcceptanceAndRefresh(write,close,get),false);assert.deepEqual(actions,['POST','close/hide','GET']);
 await get().catch(()=>{});assert.equal(actions.filter(a=>a==='POST').length,1);
 await assert.rejects(saveAcceptanceAndRefresh(async()=>{throw Error('409');},close,get));assert.equal(actions.filter(a=>a==='close/hide').length,1);
 assert.equal(await saveAcceptanceAndRefresh(write,close,async()=>{},()=>false),null);
});
test('API replacement sends both arrays explicitly; confirm version/fingerprint and files use Bearer Blob transport',async()=>{
 const apiFile=path.resolve(__dirname,'../src/api/acceptances.ts'),apiModule=new Module(apiFile,module),calls=[];
 apiModule.require=name=>name==='./client'?{apiRequest:async(url,options)=>{calls.push({url,options});return [];}}:name==='./evidence'?{evidenceRequest:async(token,url,options,blob)=>{calls.push({token,url,blob});return {};}}:require(name);
 apiModule._compile(ts.transpileModule(fs.readFileSync(apiFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,apiFile);
 const api=apiModule.exports;await api.writeAcceptance('test-only','p','old','replacement',{code:'A',title:'A',reason:'Fix',inspectionIds:[],evidenceIds:[]});assert.deepEqual(JSON.parse(calls[0].options.body).evidenceIds,[]);assert.match(calls[0].url,/old\/replacement$/);
 await api.confirmAcceptance('test-only','p','id',{version:7,sourceFingerprint:'fingerprint'});assert.deepEqual(JSON.parse(calls[1].options.body),{expectedVersion:7,expectedSourceFingerprint:'fingerprint'});
 await api.acceptanceBlob('test-only','p','id','file',false);assert.equal(calls[2].blob,true);assert.equal(calls[2].url.includes('test-only'),false);
});
