import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarFromSessions, queryOpenF1, fetchDraft} from './openf1.ts';

/** Build a season calendar only from complete qualifying/race pairs. */
test('calendarFromSessions handles Sprint and missing qualifying', () => {

  const rows = [
    {meeting_key: 1, session_name: 'Qualifying', date_start: '2027-03-02T11:00:00Z', session_key: 101},
    {meeting_key: 1, session_name: 'Race', date_start: '2027-03-03T11:00:00Z', session_key: 102},
    {meeting_key: 2, session_name: 'Sprint Qualifying', date_start: '2027-03-09T11:00:00Z', session_key: 203},
    {meeting_key: 2, session_name: 'Sprint', date_start: '2027-03-10T11:00:00Z', session_key: 204},
    {meeting_key: 2, session_name: 'Qualifying', date_start: '2027-03-10T15:00:00Z', session_key: 201},
    {meeting_key: 2, session_name: 'Race', date_start: '2027-03-11T11:00:00Z', session_key: 202},
    {meeting_key: 3, session_name: 'Race', date_start: '2027-03-20T11:00:00Z', session_key: 302}
  ];
  const events = calendarFromSessions(rows, [{meeting_key: 1, meeting_name: 'Alpha GP'}, {meeting_key: 2, meeting_name: 'Beta GP'}]);
  assert.equal(events.length, 2);
  assert.equal(events[0].round, 1);
  assert.equal(events[1].isSprint, true);
  assert.equal(events[1].openf1Keys.sprint, 204);
});

/** Refuse score imports when the required upstream session keys are missing. */
test('fetchDraft refuses missing required sessions', async () => {

  await assert.rejects(fetchDraft({}, false), {status: 400});
});

/** OpenF1 request wrapper handles non-array/malformed HTTP responses without publishing. */
test('queryOpenF1 rejects invalid upstream schema', async () => {

  const old = globalThis.fetch;
  globalThis.fetch = (async () => ({ok: true, json: async () => ({not: 'array'})})) as typeof fetch;
  try {
    await assert.rejects(queryOpenF1('sessions', {year: 2027}), {status: 502})
  }
  finally {
    globalThis.fetch = old
  }
});
