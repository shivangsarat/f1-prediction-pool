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

/** Parallel pools share an exact cache key and one upstream fetch, also across later reads. */
test('global OpenF1 cache deduplicates concurrent calendar requests', async () => {
  const old = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = (async () => {
    outbound++;
    return {ok: true,json: async () => [{meeting_key: 123,session_key: 456}]};
  }) as typeof fetch;
  try {
    const params = {year: 2099, meeting_key: Number(process.hrtime.bigint() % 1000000000n)};
    const results = await Promise.all([queryOpenF1('meetings',params),queryOpenF1('meetings',params)]);
    assert.equal(outbound,1);
    assert.deepEqual(results[0],results[1]);
    assert.deepEqual(await queryOpenF1('meetings',params),results[0]);
    assert.equal(outbound,1,'persisted cache must also avoid later requests');
  } finally {globalThis.fetch=old;}
});

/** Canonical cache keys do not depend on the insertion order of query parameters. */
test('OpenF1 canonical key and TTL rules protect shared upstream quotas', async () => {
  const {cacheKey, cacheLifetime} = await import('./openf1.ts');
  assert.equal(cacheKey('session_result',{year:2031,session_key:42}),cacheKey('session_result',{session_key:42,year:2031}));
  assert.ok(cacheLifetime('meetings') > cacheLifetime('session_result'));
  assert.ok(cacheLifetime('drivers') > cacheLifetime('sessions'));
});
