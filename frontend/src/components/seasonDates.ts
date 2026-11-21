/** Recommend a seven-day August UTC salvage window in the selected season year. */
export function suggestedAugustWindow(year: number): {start: string; end: string} {
  return {start: `${year}-08-02T12:00`, end: `${year}-08-09T12:00`};
}

/** Preserve UTC, not local timezone, when reading a datetime-local field labelled UTC. */
export function utcFieldToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid UTC date and time');
  const timestamp = new Date(`${value}:00Z`);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Enter a valid UTC date and time');
  return timestamp.toISOString();
}

/** Display a stored UTC timestamp in the UTC-labelled date input without local conversion. */
export function isoToUtcField(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}

/** Disallow mid-season championship/salvage once the UTC summer window has begun. */
export function postAugustMidseason(year: number, openingRound: number, date = new Date()): boolean {
  return openingRound > 1 && date.getTime() >= Date.UTC(year, 7, 1);
}
