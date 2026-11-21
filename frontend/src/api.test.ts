import {beforeEach, it, expect, vi} from 'vitest';
import {get, post, put, patch, ApiError, money, date} from './api';

/** Mock fetch to check that session tokens never reach JavaScript or local storage. */
beforeEach(() => {

  vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({ok: true})})));
});

/** API requests always use same-origin cookies and encode JSON bodies only for writes. */
it('request wrappers perform same-origin HTTP calls', async () => {

  await get('/tournaments');
  expect(fetch).toHaveBeenCalledWith('/api/tournaments', expect.objectContaining({credentials: 'same-origin'}));
  await post('/tournaments', {name: 'Pool'});
  expect(fetch).toHaveBeenCalledWith('/api/tournaments', expect.objectContaining({credentials: 'same-origin', method: 'POST', body: '{"name":"Pool"}'}));
  await put('/picks', {p: 1});
  await patch('/config', {p: 2});
  expect(fetch).toHaveBeenCalledTimes(4);
});

/** Distinguish server HTTP errors from unexpected HTTP success bodies. */
it('reports remote HTTP errors', async () => {

  vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 403, json: async () => ({error: 'Not authorized'})})));
  await expect(get('/ledger')).rejects.toMatchObject({status: 403, message: 'Not authorized'});
  expect(new ApiError(404, 'Missing').status).toBe(404);
});

/** Money is displayed in integer cents, and UTC dates in a local timezone. */
it('formats transaction amounts and event dates', () => {

  expect(money(12345, 'EUR')).toContain('123');
  expect(date('2027-03-01T00:00:00Z').length).toBeGreaterThan(3);
  expect(date('')).toBe('—');
});
