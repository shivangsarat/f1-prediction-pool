import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const tmp=mkdtempSync(join(tmpdir(),'f1-pool-test-'));process.env.DB_PATH=join(tmp,'test.sqlite');process.env.NODE_ENV='test';process.env.BACKUP_DIR=join(tmp,'backups');process.env.BACKUP_ENCRYPTION_KEY='aa'.repeat(32);process.env.ADMIN_EMAIL='admin@testing.example';process.env.ADMIN_BOOTSTRAP_KEY='special-register-key';
const {app}=await import('./server.ts');
const addr=await new Promise<any>(resolve=>app.listen(0,'127.0.0.1',()=>resolve(app.address())));
const origin=`http://127.0.0.1:${addr.port}`;
let admin='',player='',seasonId='',weekendId='',playerId='';
async function call(path:string,method='GET',data?:any,token?:string){const r=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()}}
test('new accounts, season, pick locks, results, payout and audit workflow',async()=>{
 let r=await call('/auth/register','POST',{email:'admin@testing.example',name:'Commissioner',password:'very-secure-admin-password',bootstrapKey:'bad'});assert.equal(r.status,403);
 r=await call('/auth/register','POST',{email:'admin@testing.example',name:'Commissioner',password:'very-secure-admin-password',bootstrapKey:'special-register-key'});assert.equal(r.status,201);admin=r.data.token;
 r=await call('/auth/register','POST',{email:'participant@testing.example',name:'Tester',password:'very-secure-player-password'});assert.equal(r.status,201);player=r.data.token;playerId=r.data.user.id;
 r=await call('/admin/seasons','POST',{year:2028,name:'F1 2028',sprintMode:'two-form',baseEntryCents:1000,currency:'EUR',preseasonLock:'2028-03-01T12:00:00Z',salvageStart:'2028-08-01T00:00:00Z',salvageEnd:'2028-08-08T00:00:00Z'},player);assert.equal(r.status,403);
 r=await call('/admin/seasons','POST',{year:2028,name:'F1 2028',sprintMode:'two-form',baseEntryCents:1000,currency:'EUR',preseasonLock:'2028-03-01T12:00:00Z',salvageStart:'2028-08-01T00:00:00Z',salvageEnd:'2028-08-08T00:00:00Z'},admin);assert.equal(r.status,201);seasonId=r.data.id;
 r=await call('/admin/roster','POST',{seasonId,drivers:Array.from({length:20},(_,i)=>({id:`D${i+1}`,name:`Driver ${i+1}`,code:`D${i+1}`,teamId:`TEAM${Math.floor(i/2)}`,teamName:`Team ${Math.floor(i/2)}`}))},admin);assert.equal(r.status,200);
 r=await call('/admin/weekends','POST',{seasonId,round:1,name:'Test GP',qualifyingAt:'2028-03-01T12:00:00Z',raceAt:'2028-03-03T12:00:00Z'},admin);assert.equal(r.status,201);weekendId=r.data.id;
 const ballot={top10:Array.from({length:10},(_,i)=>`D${i+1}`),props:{pole:'D1',fastestLap:'D2',firstDnf:'D12'}};
 r=await call(`/weekends/${weekendId}/picks/gp`,'PUT',ballot,player);assert.equal(r.status,201);
 r=await call(`/weekends/${weekendId}/picks/gp`,'PUT',{...ballot,top10:[...ballot.top10.slice(1),ballot.top10[0]]},player);assert.equal(r.status,201);assert.equal(r.data.version,2);
 r=await call(`/weekends/${weekendId}/picks`,'GET',undefined,admin);assert.equal(r.status,200);assert.equal(r.data.length,0,'Blind picks must not leak');
 r=await call(`/weekends/${weekendId}/picks`,'GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data.length,1);assert.equal(r.data[0].version,2);
 r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'buyin',amountCents:1000,description:'Full season buy-in',idempotencyKey:'fixture-buyin'},admin);assert.equal(r.status,201);
 r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'buyin',amountCents:1000,description:'Full season buy-in',idempotencyKey:'fixture-buyin'},admin);assert.equal(r.status,201);assert.equal(r.data.replayed,true);
 r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'payout',amountCents:2000,description:'Unfunded payout',idempotencyKey:'overdraw'},admin);assert.equal(r.status,409);
 // Historical outage recovery: the commissioner may enter a proven pre-lock chat ballot
 // after a server restart, but normal online entry remains locked.
 r=await call('/admin/weekends','POST',{seasonId,round:2,name:'Historical GP',qualifyingAt:'2026-02-01T12:00:00Z',raceAt:'2026-02-03T12:00:00Z',chequeredAt:'2026-02-03T14:00:00Z'},admin);assert.equal(r.status,201);const scoreId=r.data.id;
 r=await call(`/weekends/${scoreId}/picks/gp`,'PUT',ballot,player);assert.equal(r.status,409);
 r=await call(`/admin/weekends/${scoreId}/fallback`,'POST',{userId:playerId,form:'gp',pick:ballot,evidenceTimestamp:'2026-01-31T12:00:00Z',evidenceNote:'Timestamped group chat message Jan 31 2026'},admin);assert.equal(r.status,201);
 const result={finishers:Array.from({length:20},(_,i)=>({driverId:`D${i+1}`,position:i===11?null:i+1,status:i===11?'NC':'CLASSIFIED'})),poleId:'D1',fastestLapId:'D2',firstDnfIds:['D12'],greenFlagLaps:55,cancelled:false};
 r=await call(`/admin/weekends/${scoreId}/result`,'PUT',{result,finalClassification:true},admin);assert.equal(r.status,200);
 r=await call(`/admin/weekends/${scoreId}/publish`,'POST',{},admin);assert.equal(r.status,409,'must preview first');
 r=await call(`/admin/weekends/${scoreId}/preview`,'POST',{},admin);assert.equal(r.status,200);assert.ok(r.data.scores.find((s:any)=>s.userId===playerId).total>0);
 r=await call(`/admin/weekends/${scoreId}/publish`,'POST',{},admin);assert.equal(r.status,200);
 r=await call(`/admin/weekends/${scoreId}/publish`,'POST',{},admin);assert.equal(r.status,200);assert.equal(r.data.alreadyPublished,true);
 r=await call('/standings?seasonId='+seasonId,'GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data[0].userId,playerId);
 r=await call(`/admin/weekends/${scoreId}/result`,'PUT',{result,finalClassification:true},admin);assert.equal(r.status,409,'published classification frozen');
 r=await call('/ledger?seasonId='+seasonId,'GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data.cashCents,1000);assert.equal(r.data.payouts.prizes.reduce((n:number,x:any)=>n+x.amountCents,0),1000);
 r=await call('/admin/backup','POST',{},admin);assert.equal(r.status,200);assert.equal(r.data.encrypted,true);
 const snapshots=readdirSync(join(tmp,'backups'));assert.ok(snapshots.some(x=>x.endsWith('.sqlite.gz.enc')));
 assert.ok(readFileSync(join(tmp,'backups',snapshots[0])).subarray(0,5).equals(Buffer.from('F1BK\x01')));
 r=await call('/admin/audit','GET',undefined,admin);assert.equal(r.status,200);assert.ok(r.data.some((x:any)=>x.action==='result.publish'));
});
test.after(async()=>{await new Promise<void>(resolve=>app.close(()=>resolve()));rmSync(tmp,{recursive:true,force:true})});
