import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const folder = mkdtempSync(join(tmpdir(),'gridlock-v2-finance-api-'));
process.env.DB_PATH = join(folder,'finance.sqlite');
process.env.NODE_ENV = 'test';
process.env.MAIL_PROVIDER = 'none';
process.env.ADMIN_EMAIL = 'operator@gridlock.test';
process.env.ADMIN_BOOTSTRAP_KEY = 'verified-bootstrap-secret';
const {app} = await import('./server.ts');
const {run} = await import('./db.ts');
const addr = await new Promise<any>(resolve=>app.listen(0,'127.0.0.1',()=>resolve(app.address())));
const origin = `http://127.0.0.1:${addr.port}`;
let operator='',player='',commissioner='',operatorId='',ownerId='',playerId='',seasonId='',tournamentId='';

/** Send an authenticated, same-origin JSON request and preserve its HttpOnly cookie. */
async function call(path: string, method='GET', body?:any, cookie='') {
  const response = await fetch(origin+'/api'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0] ?? ''};
}

test('global policy is restricted to operator, and public and private both accept invitation links', async () => {
  let r = await call('/auth/register','POST',{email:'operator@gridlock.test',name:'Global Operator',password:'password-with-strong-length',bootstrapKey:'verified-bootstrap-secret',username:'global_fin_operator'});
  assert.equal(r.status,201); operator=r.cookie;operatorId=r.data.user.id;
  r=await call('/auth/register','POST',{email:'creator@gridlock.test',name:'Creator',password:'password-with-strong-length',username:'creator_finance'});
  assert.equal(r.status,201);commissioner=r.cookie;ownerId=r.data.user.id;
  r=await call('/auth/register','POST',{email:'player@gridlock.test',name:'Player',password:'password-with-strong-length',username:'finance_player'});
  assert.equal(r.status,201);player=r.cookie;playerId=r.data.user.id;
  r=await call('/operator/finance','GET',undefined,player);assert.equal(r.status,403);
  r=await call('/operator/finance','PATCH',{platformRakeEnabled:true,platformRakeBps:500,allowTournamentHouseRake:true},player);assert.equal(r.status,403);
  r=await call('/operator/finance','PATCH',{platformRakeEnabled:true,platformRakeBps:500,allowTournamentHouseRake:true},operator);assert.equal(r.status,200);
  r=await call('/operator/finance','PATCH',{platformRakeBps:1600},operator);assert.equal(r.status,400);
  r=await call('/tournaments','POST',{name:'Public Finance F1',description:'Open invitation competition',visibility:'public'},commissioner);assert.equal(r.status,201);
  const publicId=r.data.id,publicInvite=r.data.inviteCode;
  r=await call('/tournaments','POST',{name:'Hidden Finance F1',visibility:'invite_only'},commissioner);assert.equal(r.status,201);
  const privateId=r.data.id,privateInvite=r.data.inviteCode;
  r=await call('/catalogue');assert.equal(r.status,200);assert.equal(r.data.length,1);assert.equal(r.data[0].id,publicId);
  r=await call('/tournaments/join-public','POST',{tournamentId:privateId},player);assert.equal(r.status,404);
  r=await call('/invite-preview/'+publicInvite);assert.equal(r.status,200);assert.equal(r.data.id,publicId);
  r=await call('/tournaments/join','POST',{inviteCode:publicInvite},player);assert.equal(r.status,200);
  r=await call('/invite-preview/'+privateInvite);assert.equal(r.status,200);assert.equal(r.data.id,privateId);
  r=await call('/tournaments/join','POST',{inviteCode:privateInvite},player);assert.equal(r.status,200);
  r=await call('/tournaments/join-public','POST',{tournamentId:publicId},player);assert.equal(r.status,200);
  tournamentId=publicId;
});

test('season financial settings, live public terms, and creator permission enforce combined maximum',async()=>{
  let r=await call('/admin/seasons','POST',{tournamentId,year:2028,name:'F1 2028',baseEntryCents:1000,currency:'EUR',preseasonLock:'2028-03-01T12:00:00Z',salvageStart:'2028-08-01T00:00:00Z',salvageEnd:'2028-08-08T00:00:00Z',payoutModel:'poker',houseRakeEnabled:true,houseRakeBps:500,pokerFloorEnabled:false,pokerItmPct:40,pokerAlphaMode:'manual',pokerAlphaManual:1.5},commissioner);
  assert.equal(r.status,201);seasonId=r.data.id;
  r=await call('/admin/seasons','POST',{tournamentId,year:2029,name:'F1 2029',baseEntryCents:1000,currency:'EUR',preseasonLock:'2029-03-01T12:00:00Z',salvageStart:'2029-08-01T00:00:00Z',salvageEnd:'2029-08-08T00:00:00Z',houseRakeEnabled:true,houseRakeBps:1100},commissioner);
  assert.equal(r.status,400,'combined rake cannot exceed 15%');
  r=await call('/seasons/'+seasonId,'GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data.finance.payoutModel,'poker');
  r=await call('/catalogue');assert.equal(r.status,200);const terms=r.data.find((item:any)=>item.id===tournamentId).terms;
  assert.equal(terms.totalRakeBps,1000);assert.equal(terms.pokerFloorEnabled,false);
  r=await call('/tournaments/'+tournamentId+'/terms','GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data.totalRakeBps,1000);
  r=await call('/admin/finance-preview','POST',{seasonId,pokerItmPct:50},player);assert.equal(r.status,403);
  r=await call('/admin/finance-preview','POST',{seasonId,pokerItmPct:50},commissioner);assert.equal(r.status,200);assert.equal(r.data.payoutModel,'poker');
});

test('no double rake on partial disbursements; creator can be non-playing house',async()=>{
  let r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'buyin',amountCents:1000,description:'Full season buy-in',idempotencyKey:'v2-first-buyin'},commissioner);assert.equal(r.status,201);
  r=await call('/admin/ledger','POST',{seasonId,userId:playerId,type:'buyin',amountCents:1000,description:'Second prohibited buyin',idempotencyKey:'v2-rebuy'},commissioner);assert.equal(r.status,409);
  r=await call('/ledger?seasonId='+seasonId,'GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data.payouts.grossPotCents,1000);
  assert.equal(r.data.payouts.platformRakeCents,50);assert.equal(r.data.payouts.creatorRakeCents,50);
  r=await call('/admin/ledger','POST',{seasonId,type:'platform_rake',amountCents:50,description:'Hosting fee',idempotencyKey:'v2-early-rake'},operator);assert.equal(r.status,409,'must freeze finance before distributing rake');
  // When qualifying starts, derive the effective rules from the stored Round-1 deadline, no background cron required.
  run('INSERT INTO weekends(id,season_id,round,name,is_sprint,qualifying_at,sprint_qualifying_at,race_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    'locked-round-v2',seasonId,1,'Historic round',0,'2020-01-01T00:00:00Z',null,'2020-01-03T00:00:00Z',new Date().toISOString());
  r=await call('/admin/ledger','POST',{seasonId,type:'platform_rake',amountCents:50,description:'Hosting fee',idempotencyKey:'v2-platform-rake'},operator);assert.equal(r.status,201);assert.equal(r.data.user_id,operatorId);
  r=await call('/admin/ledger','POST',{seasonId,type:'house_rake',amountCents:50,description:'Creator house fee',idempotencyKey:'v2-creator-rake'},commissioner);assert.equal(r.status,201);assert.equal(r.data.user_id,ownerId);
  r=await call('/admin/ledger','POST',{seasonId,type:'house_rake',amountCents:1,description:'Over creator cap',idempotencyKey:'v2-overcreator'},commissioner);assert.equal(r.status,409);
  r=await call('/admin/ledger','POST',{seasonId,type:'platform_rake',amountCents:1,description:'Over operator cap',idempotencyKey:'v2-overoperator'},operator);assert.equal(r.status,409);
  r=await call('/ledger?seasonId='+seasonId,'GET',undefined,player);assert.equal(r.status,200);
  assert.equal(r.data.cashCents,900);assert.equal(r.data.payouts.grossPotCents,1000);assert.equal(r.data.payouts.netPlayerPotCents,900);
  r=await call('/operator/finance','PATCH',{platformRakeEnabled:false,allowTournamentHouseRake:false},operator);assert.equal(r.status,200);
  r=await call('/tournaments/'+tournamentId+'/terms','GET',undefined,player);assert.equal(r.status,200);assert.equal(r.data.totalRakeBps,1000,'locked season is grandfathered');
});

test.after(async()=>{await new Promise<void>(resolve=>app.close(()=>resolve()));rmSync(folder,{recursive:true,force:true});});
