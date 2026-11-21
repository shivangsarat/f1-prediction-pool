import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveSlots, allocateCents, applyProration, calculateRake, financePlan, grossFromEntries, pokerSlots, resolveAlpha, tiedSlotShares, type FinanceConfig} from './finance.ts';

/** Build an immutable, fully-paid fixture for each worked payout scenario. */
function fixture(count: number, entry = 1000) {
  const members = Array.from({length: count}, (_, i) => ({userId: `U${i}`, contributionCents: entry}));
  const rows = members.map((member, i) => ({userId: member.userId, total: count - i, exactPodiums: 0, exactTop10: 0, propPoints: 0, bestWeek: count - i}));
  return {members, rows};
}

/** Configure a test season in the same integer-cents/basis-points units as the production model. */
function config(changes: Partial<FinanceConfig> = {}): FinanceConfig {
  return {payoutModel: 'poker', platformRakeBps: 500, creatorRakeBps: 0, baseEntryCents: 1000, smallMax: 5, mediumMax: 10,
    pokerFloorEnabled: true, pokerItmPct: 20, pokerAlphaMode: 'manual', pokerAlphaManual: 1.5, scheduledRaces: 24, ...changes};
}

test('gross is buyin + refund + adjustment, ignoring all rake and partial payouts', () => {
  assert.equal(grossFromEntries([
    {type: 'buyin', amount_cents: 10000}, {type: 'refund', amount_cents: -1000}, {type: 'adjustment', amount_cents: 200},
    {type: 'platform_rake', amount_cents: -460}, {type: 'house_rake', amount_cents: -460}, {type: 'payout', amount_cents: -1500},
  ]), 9200);
  assert.throws(() => grossFromEntries([{type: 'refund', amount_cents: -1}]));
});

test('operator/creator house rake are independent, floored to cents, and limited to 15%', () => {
  assert.deepEqual(calculateRake(10000, 500, 1000), {platformRakeCents: 500, creatorRakeCents: 1000, netPlayerPotCents: 8500});
  assert.deepEqual(calculateRake(999, 333, 333), {platformRakeCents: 33, creatorRakeCents: 33, netPlayerPotCents: 933});
  assert.throws(() => calculateRake(10000, 1000, 501), /combined rake/);
});

test('Hamilton cent rounding exactly distributes all cents, favoring the higher rank on ties', () => {
  assert.deepEqual(allocateCents(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocateCents(100, [.65, .25, .10]), [65, 25, 10]);
  for (let amount = 0; amount < 1000; amount += 11) {
    assert.equal(allocateCents(amount, [1, .6, .4, .2]).reduce((a,b) => a+b, 0), amount);
  }
});

test('v2 worked poker Floor ON ladders match reference examples exactly', () => {
  for (const [n, expected] of [[5, [3032, 1718]], [10, [5204, 2487, 1809]], [20, [9977, 4174, 2727, 2122]], [50, [19794, 7645, 4617, 3349, 2681, 2279, 2015, 1830, 1696, 1594]]] as [number, number[]][]) {
    const f = fixture(n);
    const plan = financePlan(f.rows, f.members, n * 1000, config());
    assert.deepEqual(plan.slotsCents, expected, `n=${n}`);
    assert.equal(plan.slotsCents.reduce((a,b)=>a+b,0), n*950);
    assert.equal(plan.undistributedCents, 0);
  }
});

test('Floor OFF uses power-law weights without an entry floor and allows loss-reduction spots', () => {
  const f = fixture(10);
  const p = financePlan(f.rows, f.members, 10000, config({pokerFloorEnabled: false, pokerItmPct: 40}));
  assert.deepEqual(p.slotsCents, [5685, 2010, 1094, 711]);
  assert.ok(p.slotsCents[3] < 1000);
  assert.equal(p.undistributedCents, 0);
});

test('Poker Floor ON decrements insufficient paid spots without creating negative excess', () => {
  const c = config({platformRakeBps: 1500, pokerItmPct: 50});
  const result = pokerSlots(4500, c, 10, 1.5);
  assert.ok(result.length < 5);
  assert.ok(result.every(value => value >= 1000));
  assert.equal(result.reduce((a,b)=>a+b, 0), 4500);
});

test('Poker Floor OFF trims tiny bubble payouts below 25% of the base entry', () => {
  const f = fixture(80);
  const p = financePlan(f.rows, f.members, 80000, config({pokerFloorEnabled: false, pokerItmPct: 30, pokerAlphaMode: 'auto'}));
  assert.equal(p.alpha, 1.70);
  assert.equal(p.paidPlaces, 19); // Source scenario #20 reports 20; exact power-law + 25% dust rule yields 19.
  assert.ok(p.slotsCents.at(-1)! >= 250);
  assert.equal(p.slotsCents.reduce((a,b)=>a+b, 0), 76000);
});

test('Poker SNG minimum paid-spot rules and zero/one entrants', () => {
  for (const [n, paid] of [[0,0],[1,1],[3,1],[4,2],[5,2],[6,3],[9,3],[10,3],[20,4]] as const) {
    const f = fixture(n);
    const p = financePlan(f.rows, f.members, n * 1000, config());
    assert.equal(p.paidPlaces, paid, `n=${n}`);
  }
});

test('automatic steepness follows documented five-step decision tree including both floor modes', () => {
  const cases: Array<[number,number,number,number,boolean,number]> = [
    [5,24,1000,20,true,1.30], [5,6,5000,20,true,.75], [6,24,1000,40,false,.85],
    [10,24,1000,20,true,1.60], [10,8,2000,20,true,1.20], [20,24,1000,20,true,1.75],
    [20,24,1000,30,false,1.40], [30,24,1000,20,true,1.95], [50,24,5000,25,false,1.45],
    [80,24,1000,20,true,2.15], [80,24,1000,30,false,1.70],
  ];
  for (const [n,races,entry,itm,floor,expected] of cases) {
    assert.equal(resolveAlpha(config({baseEntryCents:entry,pokerItmPct:itm,pokerFloorEnabled:floor,pokerAlphaMode:'auto',scheduledRaces:races}),n),expected);
  }
  assert.equal(resolveAlpha(config(), 3),null);
  assert.equal(resolveAlpha(config({pokerAlphaManual: 2.3}), 20),2.3);
});

test('adaptive v1 compatibility, no-rake third-place refund and both-rake worked example', () => {
  const f = fixture(10);
  assert.deepEqual(financePlan(f.rows, f.members, 10000, config({payoutModel:'adaptive-3tier',platformRakeBps:0})).slotsCents,[6750,2250,1000]);
  assert.deepEqual(financePlan(f.rows, f.members, 10000, config({payoutModel:'adaptive-3tier',creatorRakeBps:500})).slotsCents,[6000,2000,1000]);
  assert.deepEqual(financePlan(f.rows, f.members, 10000, config({payoutModel:'adaptive-3tier',creatorRakeBps:1000})).slotsCents,[5625,1875,1000]);
});

test('adaptive inversion guard keeps rank 2 above rank 3 under insufficient pot', () => {
  assert.deepEqual(adaptiveSlots(4500,config(),6).slots,[2925,1125,450]);
  assert.deepEqual(adaptiveSlots(2500,config(),6).slots,[1875,625]);
});

test('unresolved tie spanning last paid poker place splits paid plus zero bubble slots', () => {
  const f = fixture(5);
  f.rows[3].total = 1;
  f.rows[4].total = 1;
  f.rows[3].bestWeek = 1; f.rows[4].bestWeek = 1;
  const shares = tiedSlotShares(f.rows, [5000,2000,1000,500]);
  assert.equal(shares.get('U3')!.amount,250);
  assert.equal(shares.get('U4')!.amount,250);
});

test('prorated entrant is capped and redistributed to eligible full-entry finishers', () => {
  const f = fixture(4);
  f.members[0].contributionCents = 500;
  const prizes = applyProration(f.rows,f.members,[3000,1000],1000);
  assert.equal(prizes[0].capCents,1500);
  assert.equal(prizes[0].amountCents,1500);
  assert.equal(prizes[1].amountCents,2500);
  assert.equal(prizes.reduce((a,b)=>a+b.amountCents,0),4000);
});

test('all-prorated winners release surplus caps and distribute the entire available prize pot', () => {
  const f = fixture(4);
  f.members[0].contributionCents = 500;
  f.members[1].contributionCents = 250;
  const prizes = applyProration(f.rows,f.members,[3000,1000],1000);
  assert.equal(prizes.reduce((a,b)=>a+b.amountCents,0),4000);
  assert.ok(prizes[0].amountCents>prizes[1].amountCents);
});

test('invalid model, basis points and negative gross pots are rejected', () => {
  const f = fixture(3);
  assert.throws(()=>financePlan(f.rows,f.members,3000,config({platformRakeBps:1000,creatorRakeBps:501})),/15%/);
  assert.throws(()=>financePlan(f.rows,f.members,3000,config({pokerItmPct:51})),/15–50%/);
  assert.throws(()=>financePlan(f.rows,f.members,3000,config({payoutModel:'hacked' as any})),/payout engine/);
  assert.throws(()=>financePlan(f.rows,f.members,-100,config()),/gross/);
});
