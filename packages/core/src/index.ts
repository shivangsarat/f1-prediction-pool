/** Domain rules transcribed from F1 Prediction Pool — System & Rules Design Document v1.0. */
export type SprintMode = 'two-form' | 'one-form';
export type FormKind = 'gp' | 'sprint' | 'unified';
export type FinishStatus = 'CLASSIFIED' | 'NC' | 'RETIRED' | 'DNS' | 'DSQ';
export interface ClassifiedDriver {driverId: string; position: number | null; status: FinishStatus; retiredLap?: number | null; retiredOrder?: number | null}
export interface GPProps {pole: string; fastestLap: string; firstDnf: string}
export interface SprintProps {winner: string; teamMostPoints: string; mostGained: string}
export interface GPPick {top10: string[]; props: GPProps}
export interface SprintPick {props: SprintProps}
export interface UnifiedPick extends GPPick {sprint: SprintProps}
export interface SprintClassification {winnerId: string | null; topTeams: string[]; topGainers: string[]}
export interface GPClassification {
  finishers: ClassifiedDriver[]; poleId: string | null; fastestLapId: string | null;
  firstDnfIds: string[]; sprint?: SprintClassification | null;
  greenFlagLaps: number; cancelled: boolean;
}
export interface ScoreLine {label: string; driverId?: string; predicted?: number; actual?: number | null; points: number; kind: 'grid'|'prop'|'sprint'}
export interface ScoreDetails {total: number; gpTotal: number; sprintTotal: number; exactPodiums: number; exactTop10: number; propPoints: number; lines: ScoreLine[]}
export type ScoreInput = {gp?: GPPick | null; sprint?: SprintPick | null; unified?: UnifiedPick | null};
export interface RankingRow {userId: string; total: number; exactPodiums: number; exactTop10: number; propPoints: number; bestWeek: number}
export type PaymentEligibility = {userId: string; contributionCents: number};
export interface Prize {userId: string; rank: number; amountCents: number; capCents: number; eligibleFraction: number}
export interface PayoutPlan {model: string; potCents: number; slotsCents: [number,number,number]; prizes: Prize[]; undistributedCents: number}

export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
export function validateGp(pick: unknown): asserts pick is GPPick {
  assert(!!pick && typeof pick === 'object', 'GP pick is required');
  const p=pick as GPPick;
  assert(Array.isArray(p.top10) && p.top10.length===10 && p.top10.every(validId), 'Top 10 must contain 10 valid drivers');
  assert(new Set(p.top10).size===10,'Top 10 drivers must be unique');
  assert(p.props && validId(p.props.pole)&&validId(p.props.fastestLap)&&validId(p.props.firstDnf), 'All three GP prop picks are required');
}
export function validateSprint(pick: unknown): asserts pick is SprintPick {
  assert(!!pick && typeof pick === 'object', 'Sprint pick is required');
  const p=pick as SprintPick;
  assert(p.props && validId(p.props.winner)&&validId(p.props.teamMostPoints)&&validId(p.props.mostGained), 'All three Sprint props are required');
}
export function validateUnified(pick: unknown): asserts pick is UnifiedPick { validateGp(pick); validateSprint({props:(pick as UnifiedPick).sprint}); }
export function validateResult(result: unknown, isSprint: boolean): asserts result is GPClassification {
  assert(!!result && typeof result==='object','Result is required');
  const r=result as GPClassification;
  assert(typeof r.cancelled==='boolean' && Number.isInteger(r.greenFlagLaps) && r.greenFlagLaps>=0,'Race cancellation and green-flag laps required');
  assert(Array.isArray(r.finishers),'Race classification required');
  const ids=new Set<string>(), positions=new Set<number>();
  for(const f of r.finishers){
    assert(validId(f.driverId)&&!ids.has(f.driverId),'Duplicate or invalid driver ID in results');ids.add(f.driverId);
    assert(['CLASSIFIED','NC','RETIRED','DNS','DSQ'].includes(f.status),'Invalid official status');
    assert(f.position===null||(Number.isInteger(f.position)&&f.position>0),'Invalid classified position');
    if(f.position!==null) {assert(!positions.has(f.position),'Duplicate finishing position');positions.add(f.position)}
  }
  assert((r.poleId===null||validId(r.poleId))&&(r.fastestLapId===null||validId(r.fastestLapId)),'Invalid pole/fastest lap IDs');
  assert(Array.isArray(r.firstDnfIds)&&r.firstDnfIds.every(validId), 'First DNF IDs must be an array');
  for(const retiree of r.firstDnfIds){const row=r.finishers.find(x=>x.driverId===retiree);assert(!!row && (row.status==='NC'||row.status==='RETIRED'),'First DNF must be officially NC/Retired, never DNS');}
  if(r.fastestLapId){assert(r.finishers.some(x=>x.driverId===r.fastestLapId&&x.status==='CLASSIFIED'),'Fastest lap must belong to a classified driver');}
  if(isSprint){assert(!!r.sprint && (r.sprint.winnerId===null||validId(r.sprint.winnerId))&&Array.isArray(r.sprint.topTeams)&&Array.isArray(r.sprint.topGainers),'Sprint results missing');}
}
export const isVoided = (result: GPClassification): boolean => result.cancelled || result.greenFlagLaps<2;
export function scoreGp(pick: GPPick | null | undefined, result: GPClassification): ScoreDetails {
  const out:ScoreDetails={total:0,gpTotal:0,sprintTotal:0,exactPodiums:0,exactTop10:0,propPoints:0,lines:[]};
  if(!pick||isVoided(result)) return out;
  const positions=new Map(result.finishers.filter(f=>f.position!==null && f.status==='CLASSIFIED').map(f=>[f.driverId,f.position!]));
  pick.top10.forEach((id, index)=>{
    const pred=index+1, actual=positions.get(id)??null, delta=actual===null?Infinity:Math.abs(pred-actual);
    let points=delta===0?(pred<=3?10:5):delta===1?3:delta===2?1:0;
    if(pred<=3&&actual!==null&&actual<=3&&pred!==actual) points+=3;
    if(delta===0){out.exactTop10++;if(pred<=3)out.exactPodiums++}
    out.gpTotal+=points;
    out.lines.push({kind:'grid',label:`P${pred}`,driverId:id,predicted:pred,actual,points});
  });
  const props:[string,string|undefined,string|null,string[]|string|null,number][]=[
    ['Pole Position',pick.props.pole,result.poleId,result.poleId,5],
    ['Fastest Lap',pick.props.fastestLap,result.fastestLapId,result.fastestLapId,5],
    ['First DNF',pick.props.firstDnf,null,result.firstDnfIds,10],
  ];
  for(const [label,guess,,winner,award] of props){ const points=Array.isArray(winner)?(winner.includes(guess!)?award:0):(winner!==null&&guess===winner?award:0);out.propPoints+=points;out.gpTotal+=points;out.lines.push({kind:'prop',label,driverId:guess,points}); }
  out.total=out.gpTotal;return out;
}
export function scoreSprint(pick: SprintPick | null | undefined, result: GPClassification): ScoreDetails {
  const out:ScoreDetails={total:0,gpTotal:0,sprintTotal:0,exactPodiums:0,exactTop10:0,propPoints:0,lines:[]};
  if(!pick||!result.sprint||isVoided(result))return out;
  for(const [label,guess,correct,award] of [
    ['Sprint Winner',pick.props.winner,result.sprint.winnerId?[result.sprint.winnerId]:[],5],
    ['Most Sprint Team Points',pick.props.teamMostPoints,result.sprint.topTeams,3],
    ['Most Sprint Places Gained',pick.props.mostGained,result.sprint.topGainers,3],
  ] as [string,string,string[],number][]){ const points=correct.includes(guess)?award:0;out.lines.push({kind:'sprint',label,driverId:guess,points});out.sprintTotal+=points;out.propPoints+=points;}
  out.total=out.sprintTotal;return out;
}
export function scoreBallot(input: ScoreInput, result: GPClassification, sprintMode: SprintMode, isSprint: boolean):ScoreDetails {
  if(isVoided(result)) return scoreGp(null,result);
  const gp=scoreGp(sprintMode==='one-form'&&isSprint?input.unified:input.gp,result);
  const sprint=!isSprint?scoreSprint(null,result):scoreSprint(sprintMode==='one-form'?input.unified?{props:input.unified.sprint}:null:input.sprint,result);
  return {total:gp.total+sprint.total,gpTotal:gp.gpTotal,sprintTotal:sprint.sprintTotal,exactPodiums:gp.exactPodiums,exactTop10:gp.exactTop10,propPoints:gp.propPoints+sprint.propPoints,lines:[...gp.lines,...sprint.lines]};
}
export function sortRankings(rows:RankingRow[]): RankingRow[]{return [...rows].sort((a,b)=> b.total-a.total||b.exactPodiums-a.exactPodiums||b.exactTop10-a.exactTop10||b.propPoints-a.propPoints||b.bestWeek-a.bestWeek||a.userId.localeCompare(b.userId));}
export function isSameRank(a:RankingRow,b:RankingRow):boolean {return a.total===b.total&&a.exactPodiums===b.exactPodiums&&a.exactTop10===b.exactTop10&&a.propPoints===b.propPoints&&a.bestWeek===b.bestWeek;}
export function rankWithTies(rows:RankingRow[]):Array<RankingRow&{rank:number}>{
 const ordered=sortRankings(rows);const ranked:Array<RankingRow&{rank:number}>=[];
 ordered.forEach((row,i)=>ranked.push({...row,rank:i>0&&isSameRank(row,ordered[i-1])?ranked[i-1].rank:i+1}));
 return ranked;
}

/** All money is integer cents. Allocation order ensures published totals cannot exceed actual cash. */
export function payoutPlan(rows:RankingRow[], members:PaymentEligibility[], potCents:number, baseEntryCents:number, thresholds:{smallMax:number;mediumMax:number}={smallMax:5,mediumMax:10}):PayoutPlan {
  assert(Number.isInteger(potCents)&&potCents>=0&&Number.isInteger(baseEntryCents)&&baseEntryCents>0,'Invalid financial amounts');
  assert(thresholds.smallMax>=3&&thresholds.mediumMax>thresholds.smallMax,'Invalid tier cutoffs');
  const eligible=members.filter(m=>m.contributionCents>0), count=eligible.length;
  const slots:[number,number,number]=[0,0,0];let model='No paid players';
  const split=(amount:number,weights:number[]):number[]=>{const base=weights.map(w=>Math.floor(amount*w));let left=amount-base.reduce((x,y)=>x+y,0);for(let i=0;left>0;i=(i+1)%base.length){base[i]++;left--}return base};
  if(count===0){return {model,potCents,slotsCents:slots,prizes:[],undistributedCents:potCents}}
  if(count<=3){model='Winner takes all';slots[0]=potCents}
  else if(count<=thresholds.smallMax){model='75/25 top two';const parts=split(potCents,[.75,.25]);slots[0]=parts[0];slots[1]=parts[1]}
  else if(count<=thresholds.mediumMax){model='Third refund + 75/25 remainder';slots[2]=Math.min(baseEntryCents,potCents);const parts=split(potCents-slots[2],[.75,.25]);slots[0]=parts[0];slots[1]=parts[1]}
  else {model='65/25/10';const parts=split(potCents,[.65,.25,.10]);slots.splice(0,3,...parts as [number,number,number]);}
  const ordered=rankWithTies(rows).filter(r=>eligible.some(m=>m.userId===r.userId));
  const baseline=new Map<string,number>(), rankMap=new Map<string,number>();
  for(let i=0;i<ordered.length;i++){
    const r=ordered[i];let j=i+1;while(j<ordered.length&&isSameRank(ordered[i],ordered[j]))j++;
    const pooled=slots.slice(i,j).reduce((a,b)=>a+b,0);const per=Math.floor(pooled/(j-i)), extra=pooled%(j-i);
    for(let k=i;k<j;k++){ baseline.set(ordered[k].userId,per+(k-i<extra?1:0));rankMap.set(ordered[k].userId,i+1);}
    i=j-1;
  }
  const prizes=ordered.map(r=>{
    const m=eligible.find(m=>m.userId===r.userId)!;const fraction=Math.min(1,m.contributionCents/baseEntryCents);
    const initial=baseline.get(r.userId)??0; const cap=Math.floor(initial*fraction);
    return {userId:r.userId,rank:rankMap.get(r.userId)!,amountCents:cap,capCents:cap,eligibleFraction:fraction};
  });
  // A forfeited partial-entry share is reallocated to fully paid winners first. A prorated
  // entrant is never allowed to collect more than their fraction of the original prize slot.
  let remaining=potCents-prizes.reduce((s,p)=>s+p.amountCents,0);
  const redistributable=prizes.filter(p=>p.eligibleFraction===1 && p.capCents>0);
  if(remaining>0&&redistributable.length){const weights=redistributable.map(p=>p.capCents);const sum=weights.reduce((a,b)=>a+b,0);
    const values=weights.map(w=>Math.floor(remaining*w/sum));let residual=remaining-values.reduce((a,b)=>a+b,0);
    for(let i=0;residual>0;i=(i+1)%values.length){values[i]++;residual--}
    redistributable.forEach((p,i)=>{p.amountCents+=values[i]});remaining=0;
  }
  return {model,potCents,slotsCents:slots,prizes,undistributedCents:remaining};
}
export function utcNow(){return new Date().toISOString()}
export function locked(deadline:string, now=new Date()):boolean {const t=Date.parse(deadline);assert(Number.isFinite(t),'Invalid UTC deadline');return now.getTime()>=t}
export function formDeadline(w:{isSprint:boolean;qualifyingAt:string;sprintQualifyingAt:string|null},mode:SprintMode,form:FormKind):string{
  if(!w.isSprint){assert(form==='gp','Only GP form on non-Sprint weekends');return w.qualifyingAt}
  if(mode==='one-form'){assert(form==='unified','Unified form required in one-form mode');return w.sprintQualifyingAt!}
  if(form==='sprint')return w.sprintQualifyingAt!;
  assert(form==='gp','GP or Sprint form required');return w.qualifyingAt;
}
