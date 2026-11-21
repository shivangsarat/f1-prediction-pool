import test from 'node:test'; import assert from 'node:assert/strict';
import {scoreGp, scoreSprint, scoreBallot, payoutPlan, rankWithTies, locked, formDeadline, validateGp} from './rules.ts';
const gp = {top10: Array.from({length: 10}, (_, i) => `D${i + 1}`), props: {pole: 'D1', fastestLap: 'D2', firstDnf: 'D20'}};
const result = {finishers: Array.from({length: 20}, (_, i) => ({driverId: `D${i + 1}`, position: i + 1, status: 'CLASSIFIED' as const})), poleId: 'D1', fastestLapId: 'D2', firstDnfIds: ['D20'], greenFlagLaps: 50, cancelled: false};
test('perfect GP = 85, exact podium does not stack', () => {
  const s = scoreGp(gp, result);
  assert.equal(s.total, 85);
  assert.equal(s.exactPodiums, 3);
  assert.equal(s.exactTop10, 10)
});
test('wrong podium ordering and strict P10 boundaries', () => {

  const x = structuredClone(result);
  x.finishers[0].position = 2;
  x.finishers[1].position = 1;
  x.finishers[9].position = 11;
  x.finishers[10].position = 10;
  const s = scoreGp(gp, x);
  assert.equal(s.lines[0].points, 6);
  assert.equal(s.lines[1].points, 6);
  assert.equal(s.lines[9].points, 3);
});
test('exact P1/P3 and midpoint proximity examples', () => {
  const x = structuredClone(result);
  x.finishers[0].position = 3;
  x.finishers[2].position = 1;
  assert.equal(scoreGp(gp, x).lines[0].points, 4)
});
test('DNS/DSQ driver cannot score placement', () => {
  const x = structuredClone(result);
  x.finishers[0].status = 'DNS';
  assert.equal(scoreGp(gp, x).lines[0].points, 0)
});
test('sprint = 11, ties supported', () => {
  const x = {...result, sprint: {winnerId: 'D1', topTeams: ['A', 'B'], topGainers: ['D5', 'D8']}};
  const s = scoreSprint({props: {winner: 'D1', teamMostPoints: 'B', mostGained: 'D8'}}, x);
  assert.equal(s.total, 11);
  const both = scoreBallot({gp, sprint: {props: {winner: 'D1', teamMostPoints: 'B', mostGained: 'D8'}}}, x, 'two-form', true);
  assert.equal(both.total, 96)
});
test('missing sprint form does not forfeit GP in two-form mode', () => {
  const x = {...result, sprint: {winnerId: 'D1', topTeams: ['A'], topGainers: ['D5']}};
  assert.equal(scoreBallot({gp}, x, 'two-form', true).total, 85)
});
test('missing unified form forfeits whole weekend', () => {
  const x = {...result, sprint: {winnerId: 'D1', topTeams: ['A'], topGainers: ['D5']}};
  assert.equal(scoreBallot({gp}, x, 'one-form', true).total, 0)
});
test('cancellation and fewer than 2 green flag laps void', () => {
  assert.equal(scoreGp(gp, {...result, greenFlagLaps: 1}).total, 0)
});
test('unique GP grid validation', () => {
  assert.throws(() => validateGp({...gp, top10: Array(10).fill('D1')}))
});
test('timestamp locks including boundary and sprint modes', () => {
  assert.equal(locked('2026-01-01T12:00:00Z', new Date('2026-01-01T12:00:00Z')), true);
  assert.equal(formDeadline({isSprint: true, qualifyingAt: 'q', sprintQualifyingAt: 's'}, 'two-form', 'sprint'), 's')
});
/**
 * Construct a deterministic participant fixture for rules tests.
 * @param id - Input to this operation.
 * @param pts - Input to this operation.
 */
const row = (id: string, pts = 0) => ({userId: id, total: pts, exactPodiums: 0, exactTop10: 0, propPoints: 0, bestWeek: pts});
test('rank ties share rank', () => {
  const r = rankWithTies([row('a', 10), row('b', 10), row('c', 5)]);
  assert.deepEqual(r.map(x => x.rank), [1, 1, 3])
});
test('worked payout schedule, every threshold', () => {

  for (const [n, expect] of [[3, [3000, 0, 0]], [4, [3000, 1000, 0]], [5, [3750, 1250, 0]], [6, [3750, 1250, 1000]], [8, [5250, 1750, 1000]], [10, [6750, 2250, 1000]], [11, [7150, 2750, 1100]], [15, [9750, 3750, 1500]], [20, [13000, 5000, 2000]]] as [number, number[]][]) {

    const m = Array.from({length: n}, (_, i) => ({userId: `U${i}`, contributionCents: 1000}));
    const p = payoutPlan(m.map((v, i) => row(v.userId, 100 - i)), m, n * 1000, 1000);
    assert.deepEqual(p.slotsCents, expect, `n=${n}`);
    assert.equal(p.prizes.reduce((s, v) => s + v.amountCents, 0), n * 1000)
  }
});
test('prorated entrant is capped, pot not exceeded', () => {

  const m = [{userId: 'A', contributionCents: 500}, ...Array.from({length: 5}, (_, i) => ({userId: `U${i}`, contributionCents: 1000}))];
  const p = payoutPlan(m.map((v, i) => row(v.userId, 100 - i)), m, 5500, 1000);
  assert.equal(p.prizes[0].amountCents, Math.floor(p.slotsCents[0] / 2));
  assert.equal(p.prizes.reduce((s, v) => s + v.amountCents, 0), 5500)
});
test('tie pools slots and splits evenly', () => {
  const m = Array.from({length: 4}, (_, i) => ({userId: `U${i}`, contributionCents: 1000}));
  const p = payoutPlan(m.map((v, i) => row(v.userId, i < 2 ? 100 : 50 - i)), m, 4000, 1000);
  assert.equal(p.prizes[0].amountCents, 2000);
  assert.equal(p.prizes[1].amountCents, 2000)
});
