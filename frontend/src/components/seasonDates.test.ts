import {expect,it} from 'vitest';
import {isoToUtcField,postAugustMidseason,suggestedAugustWindow,utcFieldToIso} from './seasonDates';

/** August defaults are always seven days in the chosen season year. */
it('sets year-specific valid August UTC dates', () => {
  expect(suggestedAugustWindow(2026)).toEqual({start:'2026-08-02T12:00',end:'2026-08-09T12:00'});
});

/** August 1 at Irish midnight crosses into July UTC when parsed as browser local time. */
it('serializes UTC fields without applying the browser timezone', () => {
  expect(utcFieldToIso('2027-08-01T00:00')).toBe('2027-08-01T00:00:00.000Z');
  expect(isoToUtcField('2027-08-01T00:00:00.000Z')).toBe('2027-08-01T00:00');
});

/** Scoring options are unavailable for an already-started August break in mid-season mode. */
it('identifies post-August mid-season launches', () => {
  expect(postAugustMidseason(2026,20,new Date('2026-11-21T12:00:00Z'))).toBe(true);
  expect(postAugustMidseason(2027,20,new Date('2026-11-21T12:00:00Z'))).toBe(false);
  expect(postAugustMidseason(2026,1,new Date('2026-11-21T12:00:00Z'))).toBe(false);
});
