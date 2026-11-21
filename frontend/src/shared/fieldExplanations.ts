/** User-facing names and descriptions; API keys remain unchanged for backward compatibility. */
export const fieldExplanations: Record<string, {name: string; detail: string}> = {
  'DISPLAY NAME': {name: 'Your display name', detail: 'The name other participants see on leaderboards and invitation cards; it does not change your sign-in email.'},
  'USERNAME (USED FOR INVITATIONS)': {name: 'Username', detail: 'A unique public handle commissioners can search to invite you. It does not reveal your email address.'},
  'EMAIL ADDRESS': {name: 'Email address', detail: 'Used to sign in and, if you verify it and opt in, receive tournament updates.'},
  PASSWORD: {name: 'Password', detail: 'A private password with at least 12 characters. The server stores a salted password hash, never your plaintext password.'},
  'PLATFORM OPERATOR KEY (SPECIAL ACCOUNTS ONLY)': {name: 'Operator setup key (optional)', detail: 'Only for the designated global operator account during first registration. Ordinary players leave this blank.'},
  'TOURNAMENT NAME': {name: 'Tournament name', detail: 'Public name shown in your tournament list and, for public pools, the catalogue.'},
  'DESCRIPTION (OPTIONAL)': {name: 'Tournament description (optional)', detail: 'A short summary of the competition and its intended participants.'},
  'INVITATION CODE OR LINK': {name: 'Invitation code or link', detail: 'A secret link shared by a commissioner. Both public and invite-only tournaments accept invitations.'},
  NAME: {name: 'Tournament name', detail: 'The name participants see for this competition.'},
  DESCRIPTION: {name: 'Tournament description', detail: 'A short description visible to members and in the public catalogue where applicable.'},
  USERNAME: {name: 'Find by username', detail: 'Search existing accounts by public username to send a private invitation; email addresses are never exposed.'},
  'SEASON YEAR': {name: 'F1 season year', detail: 'Calendar year used to select races, drivers and championship results for this tournament.'},
  'CURRENCY (ISO 4217)': {name: 'Prize currency', detail: 'Three-letter currency code used only for recording fees and prize allocations, such as EUR. No money is transferred by GRIDLOCK.'},
  'BASE ENTRY (CENTS)': {name: 'Entry fee (in cents)', detail: 'Cost of a full entry recorded in the tournament ledger. For example, 1000 cents means €10. Free mini-cups use zero.'},
  'SMALL POOL UPPER CUTOFF': {name: 'Small pool: max players', detail: 'A pool at or below this number uses the small-pool payout distribution.'},
  'MEDIUM POOL UPPER CUTOFF': {name: 'Medium pool: max players', detail: 'A pool above the small-pool limit but at or below this limit uses the medium-pool payout distribution.'},
  'CHAMPIONSHIP DEADLINE (UTC OFFSET CONVERTED)': {name: 'Championship picks close', detail: 'Last time members may select world champions. The saved deadline is UTC and may not be after the first qualifying lock.'},
  'SALVAGE WINDOW OPENS (UTC)': {name: 'August pick changes open (UTC)', detail: 'Start of the optional seven-day August period to revise championship picks for a points penalty.'},
  'SALVAGE WINDOW CLOSES (UTC)': {name: 'August pick changes close (UTC)', detail: 'End of the optional seven-day August period. It must be exactly seven days after opening and stay inside August UTC.'},
  'OPENF1 SESSION KEY': {name: 'OpenF1 session ID', detail: 'Import drivers from a specific historical or current session if the automatic roster sync cannot be used.'},
  'CALENDAR YEAR': {name: 'Calendar year', detail: 'F1 championship year to preview and import upcoming official session dates from OpenF1.'},
  'ROUND NUMBER': {name: 'F1 round number', detail: 'The real round number in the selected F1 championship, not a count starting at one for mid-season pools.'},
  'EVENT NAME': {name: 'Grand Prix name', detail: 'Name shown in the prediction selector, e.g. Qatar Grand Prix.'},
  'QUALIFYING START': {name: 'Qualifying start time', detail: 'Time after which the Grand Prix predictions become immutable. Converted to UTC on save.'},
  'RACE START': {name: 'Race start time', detail: 'Expected race start, used for the calendar and publishing timeline. Converted to UTC on save.'},
  'SPRINT QUALIFYING START': {name: 'Sprint qualifying time', detail: 'Lock time for Sprint or combined predictions. It may be earlier than Grand Prix qualifying.'},
  'AUDIT / OVERRIDE NOTE': {name: 'Result review note', detail: 'Optional record of the official result source or why a commissioner changed a draft.'},
  'EVIDENCE TIME': {name: 'Evidence timestamp', detail: 'Timestamp proving a prediction was received before the actual qualifying lock during an outage.'},
  'EVIDENCE NOTE / SOURCE': {name: 'Evidence source and note', detail: 'An auditable reference to the original pre-lock message or screenshot; the commissioner cannot invent a late pick.'},
  'AMOUNT (CENTS)': {name: 'Transaction amount (cents)', detail: 'Whole-cent amount for the ledger entry, not a charge made by GRIDLOCK. Payouts and refunds are independently validated.'},
  'TRANSACTION DESCRIPTION': {name: 'Reason for transaction', detail: 'Explanation of this buy-in, refund, adjustment or payout. Stored in the audit-friendly season ledger.'},
  'Tournament': {name: 'Tournament', detail: 'Name of this competition.'},
};

/** Resolve a friendly field name and its explanation without renaming API properties. */
export function explainField(label: string): {name: string; detail: string} {
  return fieldExplanations[label] ?? {name: label, detail: `What the ${label.toLowerCase()} field controls in this form.`};
}
