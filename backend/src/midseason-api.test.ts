import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const folder = mkdtempSync(join(tmpdir(), 'gridlock-midseason-api-'));
process.env.DB_PATH = join(folder, 'pool.sqlite');
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'operator@mid.test';
process.env.ADMIN_BOOTSTRAP_KEY = 'operator-key-for-tests';
process.env.MAIL_PROVIDER = 'none';
const {app} = await import('./server.ts');
const {run, get} = await import('./db.ts');
const address = await new Promise<any>(resolve => app.listen(0, '127.0.0.1', () => resolve(app.address())));
const origin = `http://127.0.0.1:${address.port}`;
let operator = '', owner = '', player = '', ownerId = '', playerId = '', tournamentId = '', seasonId = '';

/** Send a real HTTP request through the cookie-authenticated same-origin API. */
async function call(path: string, method = 'GET', data?: any, cookie = '') {
  const result = await fetch(`${origin}/api${path}`, {method,headers: {Origin: origin,'Content-Type': 'application/json',...(cookie ? {Cookie:cookie} : {})},body: data === undefined ? undefined : JSON.stringify(data)});
  return {status:result.status,body:await result.json(),cookie:result.headers.get('set-cookie')?.split(';')[0] ?? ''};
}

/** New tournament launch metadata survives restarts and global policy updates. */
test('global policy restricts public mid-season creation but not private invitations', async () => {
  let r = await call('/auth/register','POST',{email:'operator@mid.test',name:'Operator',password:'long-super-secret-operator-password',bootstrapKey:'operator-key-for-tests',username:'operator_mid'});
  assert.equal(r.status,201);operator=r.cookie;
  r = await call('/auth/register','POST',{email:'owner@mid.test',name:'Pool Owner',password:'long-super-secret-owner-password',username:'owner_mid'});
  assert.equal(r.status,201);owner=r.cookie;ownerId=r.body.user.id;
  r = await call('/auth/register','POST',{email:'player@mid.test',name:'Pool Participant',password:'long-super-secret-player-password',username:'player_mid'});
  assert.equal(r.status,201);player=r.cookie;playerId=r.body.user.id;
  r=await call('/operator/finance','PATCH',{allowPublicMidseason:false,maxActiveOwnedPools:3},operator);
  assert.equal(r.status,200);
  r=await call('/tournaments','POST',{name:'Restricted Public Reset',visibility:'public',openingRound:12,expectedRaces:12,year:2028},owner);
  assert.equal(r.status,403);
  r=await call('/tournaments','POST',{name:'Private Mid Pool',visibility:'invite_only',openingRound:12,expectedRaces:12,year:2028},owner);
  assert.equal(r.status,201);tournamentId=r.body.id;
  assert.equal(r.body.launch_opening_round,12);
  const link=r.body.inviteCode;
  r=await call('/invite-preview/'+link);assert.equal(r.status,200);
  r=await call('/tournaments/join','POST',{inviteCode:link},player);assert.equal(r.status,200);
  r=await call('/catalogue?scope=mid');assert.equal(r.status,200);assert.ok(!r.body.some((p:any)=>p.id===tournamentId));
  r=await call('/tournaments','POST',{name:'Other Active Pool',visibility:'invite_only'},owner);assert.equal(r.status,201);
  r=await call('/tournaments','POST',{name:'Third Active Pool',visibility:'invite_only'},owner);assert.equal(r.status,201);
  r=await call('/tournaments','POST',{name:'Fourth Active Pool',visibility:'invite_only'},owner);assert.equal(r.status,409);
  r=await call('/operator/finance','PATCH',{allowPublicMidseason:true},operator);assert.equal(r.status,200);
  r=await call(`/tournaments/${tournamentId}`,'PATCH',{visibility:'public'},owner);assert.equal(r.status,200);
  r=await call('/catalogue?scope=mid');assert.equal(r.status,200);assert.equal(r.body[0].id,tournamentId);
  r=await call('/catalogue?scope=full');assert.equal(r.status,200);assert.ok(!r.body.some((p:any)=>p.id===tournamentId));
});

/** A mid-year mini-cup has nullable August dates, an independent opening round and zero champion bonuses. */
test('mid-season season scope, upcoming-only import, cash and preserved balances', async () => {
  let r=await call('/admin/seasons','POST',{tournamentId,year:2028,openingRound:12,expectedRaces:12,
    name:'Remaining 2028 Rounds',baseEntryCents:1000,championshipEnabled:true,salvageEnabled:true,
    salvageStart:'2028-08-01T00:00:00Z',salvageEnd:'2028-08-08T00:00:00Z'},owner);
  assert.equal(r.status,201);seasonId=r.body.id;
  r=await call(`/seasons/${seasonId}`, 'GET', undefined,player);assert.equal(r.status,200);assert.equal(r.body.opening_round,12);
  assert.equal(r.body.preseason_lock,null);
  const events=Array.from({length:12},(_,i)=>{
    const qualifyingAt=new Date(Date.UTC(2028,4,1+i*7)).toISOString();
    const raceAt=new Date(Date.UTC(2028,4,3+i*7)).toISOString();
    return {round:12+i,name:`Mid GP ${i}`,qualifyingAt,raceAt,isSprint:false};
  });
  r=await call('/admin/openf1/import-calendar','POST',{seasonId,upcomingOnly:true,startFromRound:12,events:[
    {round:1,name:'Excluded Race',qualifyingAt:'2020-01-01T12:00:00Z',raceAt:'2020-01-03T12:00:00Z'},...events]},owner);
  assert.equal(r.status,200);assert.equal(r.body.created,12);
  r=await call(`/season-scope?seasonId=${seasonId}`,'GET',undefined,player);
  assert.equal(r.status,200);assert.equal(r.body.scheduledRaces,12);
  assert.equal(r.body.championshipBonus,13);assert.equal(r.body.salvagePenalty,8);
  assert.equal(r.body.weekends[0].round,12);
  r=await call('/championship-picks','PUT',{seasonId,category:'wdc',choice:'1'},player);
  assert.equal(r.status,400,'a configured driver roster is still required');
  r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'buyin',amountCents:1000,
    description:'Competition entry',idempotencyKey:'mid-entry'},owner);assert.equal(r.status,201);
  // Mimic server waking after the opening deadline: no timer or manual lock mutation is needed.
  run("UPDATE weekends SET qualifying_at='2020-01-01T00:00:00Z' WHERE season_id=? AND round=12",seasonId);
  r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'refund',amountCents:100,
    description:'Withdrawal to other tournament',idempotencyKey:'mid-refund'},owner);
  assert.equal(r.status,409);
  r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'adjustment',amountCents:-100,
    description:'Withdrawal adjustment',idempotencyKey:'mid-adjust'},owner);
  assert.equal(r.status,409);
  r=await call('/ledger?seasonId='+seasonId,'GET',undefined,player);
  assert.equal(r.status,200);assert.equal(r.body.grossPotCents,1000);
  assert.equal(get('SELECT COUNT(*) AS n FROM weekends WHERE season_id=?',seasonId)?.n,12);
});

/** 1–2 race pools remain free; no misleading paid payout entitlement can be recorded. */
test('post-August mini-cup uses pure race-by-race and protects paid contributions', async () => {
  let r=await call('/tournaments','POST',{name:'Late-Season Free Sprint',visibility:'invite_only',openingRound:23,expectedRaces:2,year:2028},operator);
  assert.equal(r.status,201);
  const tid=r.body.id;
  r=await call('/admin/seasons','POST',{tournamentId:tid,year:2028,openingRound:23,expectedRaces:2,baseEntryCents:1000,
    championshipEnabled:false,salvageEnabled:false},operator);
  assert.equal(r.status,409);
  r=await call('/admin/seasons','POST',{tournamentId:tid,year:2028,openingRound:23,expectedRaces:2,baseEntryCents:0,
    championshipEnabled:false,salvageEnabled:false},operator);
  assert.equal(r.status,201);
  const id=r.body.id;
  r=await call('/championship-picks','PUT',{seasonId:id,category:'wdc',choice:'1'},operator);
  assert.equal(r.status,409);
  r=await call('/admin/ledger','POST',{seasonId:id,userId:playerId,type:'buyin',amountCents:1000,
    description:'Should never collect funds',idempotencyKey:'free-payment'},operator);
  assert.equal(r.status,409);
  r=await call('/ledger?seasonId='+id,'GET',undefined,operator);
  assert.equal(r.status,200);assert.equal(r.body.payouts.grossPotCents,0);assert.equal(r.body.payouts.paidPlaces,0);
  // Once all remaining rounds are published, there is no August or WDC/WCC gate.
  const dates = [new Date(Date.UTC(2028, 10, 1)), new Date(Date.UTC(2028, 10, 8))];
  const events = dates.map((d,index)=>({round:23+index,name:`Free GP ${index+1}`,
    qualifyingAt:d.toISOString(),raceAt:new Date(d.getTime()+86400000).toISOString(),isSprint:false}));
  r=await call('/admin/openf1/import-calendar','POST',{seasonId:id,events,upcomingOnly:true},operator);
  assert.equal(r.status,200);assert.equal(r.body.created,2);
  const configured = get('SELECT COUNT(*) AS n FROM weekends WHERE season_id=?',id)?.n;
  assert.equal(configured,2);
  run("UPDATE weekends SET qualifying_at='2020-01-01T00:00:00Z',race_at='2020-01-03T00:00:00Z' WHERE season_id=?",id);
  for (const w of (await import('./db.ts')).all('SELECT id FROM weekends WHERE season_id=?',id)) {
    run(`INSERT INTO results(weekend_id,payload,source,version,final_classification,published_at,updated_at)
      VALUES(?, '{}', 'manual',1,1,?,?)`,w.id,new Date().toISOString(),new Date().toISOString());
  }
  r=await call('/admin/champions','POST',{seasonId:id},operator);
  assert.equal(r.status,200,'pure race-by-race seasons must finalize without championship winners');
  assert.equal(get('SELECT wdc FROM champions WHERE season_id=?',id)?.wdc,'');
});

test.after(async()=>{await new Promise<void>(resolve=>app.close(()=>resolve()));rmSync(folder,{recursive:true,force:true});});
