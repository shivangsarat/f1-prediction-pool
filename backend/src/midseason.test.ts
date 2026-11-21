import test from 'node:test';
import assert from 'node:assert/strict';
import {midseasonPreview, openingQualifying, scaledSeasonPoints, seasonScope, validateMidseasonConfiguration, validateSalvageWindow, notificationPriority} from './midseason.ts';

/** Full-season payouts and bonuses remain backward-compatible. */
test('full-season mode retains original championship bonuses', () => {
  assert.equal(seasonScope(1), 'full');
  assert.deepEqual(scaledSeasonPoints(1, 24), {championshipBonus: 25, salvagePenalty: 15});
});

/** 12-round tournaments use exact spec 13/8 scaled points with no inherited races. */
test('midseason remaining-round scoring and labels', () => {
  const preview = midseasonPreview(12, 12, true, 5);
  assert.equal(preview.label, 'Mid-Season · Starts R12 · 12 Races');
  assert.equal(preview.championshipBonus, 13);
  assert.equal(preview.salvagePenalty, 8);
  assert.equal(preview.allowChampionship, true);
  assert.equal(preview.allowSalvage, true);
  assert.equal(preview.defaultChampionshipEnabled, false);
});

/** Late minis disable championship predictions and August salvage by default. */
test('late season and <3-race free-only fairness', () => {
  const late = midseasonPreview(20, 5, false, 0);
  assert.equal(late.allowChampionship, false);
  assert.equal(late.allowSalvage, false);
  assert.equal(late.paidAllowed, true);
  assert.equal(midseasonPreview(23, 2, false, 0).paidAllowed, false);
  assert.throws(() => validateMidseasonConfiguration({openingRound: 23, scheduledRaces: 2, baseEntryCents: 1000, championshipEnabled: false, salvageEnabled: false, startsBeforeAugust: false, completedBeforeAugust: 0}), {status: 409});
  assert.doesNotThrow(() => validateMidseasonConfiguration({openingRound: 23, scheduledRaces: 2, baseEntryCents: 0, championshipEnabled: false, salvageEnabled: false, startsBeforeAugust: false, completedBeforeAugust: 0}));
});

/** Reject optional championship and salvage switches outside their eligible window. */
test('midseason championship and salvage eligibility', () => {
  const input = {openingRound: 12, scheduledRaces: 12, baseEntryCents: 1000, championshipEnabled: true, salvageEnabled: true, startsBeforeAugust: true, completedBeforeAugust: 3};
  assert.throws(() => validateMidseasonConfiguration(input), {status: 409});
  assert.doesNotThrow(() => validateMidseasonConfiguration({...input, completedBeforeAugust: 4}));
  assert.throws(() => validateMidseasonConfiguration({...input, startsBeforeAugust: false, completedBeforeAugust: 4}), {status: 409});
  assert.throws(() => validateMidseasonConfiguration({...input, championshipEnabled: false, salvageEnabled: true}), {status: 409});
});

/** Sprint qualifying is always the first immutable qualifying deadline. */
test('dynamic opening lock respects Sprint format', () => {
  assert.equal(openingQualifying({is_sprint: 1, qualifying_at: '2027-07-03Z', sprint_qualifying_at: '2027-07-02Z'}), '2027-07-02Z');
  assert.equal(openingQualifying({is_sprint: 0, qualifying_at: '2027-07-03Z'}), '2027-07-03Z');
});

/** Important service messages must precede invitations in the shared mail queue. */
test('email priorities guard shared free transactional quotas', () => {
  assert.ok(notificationPriority('locked:race') > notificationPriority('invited:race'));
  assert.ok(notificationPriority('result:race') > notificationPriority('invited:race'));
});

/** The August dates are UTC-specific; a Dublin-local midnight can fall in July UTC. */
test('salvage dates require seven August days in the chosen season and an upcoming window', () => {
  const before = Date.parse('2027-06-01T00:00:00Z');
  assert.doesNotThrow(() => validateSalvageWindow(2027, '2027-08-02T12:00:00Z', '2027-08-09T12:00:00Z', before));
  assert.throws(() => validateSalvageWindow(2027, '2027-07-31T23:00:00Z', '2027-08-07T23:00:00Z', before), {status: 400});
  assert.throws(() => validateSalvageWindow(2026, '2027-08-02T12:00:00Z', '2027-08-09T12:00:00Z', before), {status: 400});
  assert.throws(() => validateSalvageWindow(2027, '2027-08-02T12:00:00Z', '2027-08-09T12:00:00Z', Date.parse('2027-11-21T00:00:00Z')), {status: 409});
});
