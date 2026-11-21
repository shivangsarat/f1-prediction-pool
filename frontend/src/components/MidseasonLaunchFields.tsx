import {useState} from 'react';
import {get} from '../api';
import {Action, Notice} from '../shared/ui';

/** Fields accepted by the tournament launch preview and retained for commissioner setup. */
export type LaunchFields = {year: number; openingRound: number; expectedRaces: number};

/** Shared upcoming-race preview returned by the SQLite-cached OpenF1 calendar endpoint. */
type Preview = LaunchFields & {scope: 'full' | 'mid'; upcomingOnly: boolean};

/** Let a creator choose mid-season scope and optionally detect remaining races from OpenF1. */
export function MidseasonLaunchFields({value, onChange}: {value: LaunchFields; onChange: (next: LaunchFields) => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mid = value.openingRound > 1;

  /** Synchronize form fields with a cached calendar without silently publishing a schedule. */
  async function detectUpcoming() {
    setBusy(true); setError('');
    try {
      const result = await get<Preview>(`/calendar/remaining?year=${value.year}`);
      if (!result.openingRound) throw new Error('No upcoming OpenF1 qualifying rounds found for that year');
      onChange({...value, openingRound: result.openingRound, expectedRaces: result.expectedRaces});
    } catch (err) {setError((err as Error).message);}
    finally {setBusy(false);}
  }

  return <fieldset className="midseason-launch" aria-label="Tournament launch scope">
    <legend className="input-label">TOURNAMENT SCOPE</legend>
    <label className="input-label">LAUNCH MODE
      <select aria-label="Launch mode" value={mid ? 'mid' : 'full'} onChange={event => onChange({...value,
        openingRound: event.target.value === 'full' ? 1 : 2,
        expectedRaces: event.target.value === 'full' ? 24 : 0})}>
        <option value="full">Full Season · Start Round 1</option>
        <option value="mid">Mid-Season · Future rounds only</option>
      </select>
    </label>
    {mid && <>
      <div className="form-grid">
        <label className="input-label">F1 YEAR<input type="number" aria-label="Launch calendar year" value={value.year} min={2023} max={2200} onChange={e => onChange({...value,year:Number(e.target.value)})}/></label>
        <label className="input-label">OPENING F1 ROUND<input type="number" aria-label="Opening F1 round" value={value.openingRound} min={2} max={40} onChange={e => onChange({...value,openingRound:Number(e.target.value)})}/></label>
        <label className="input-label">REMAINING RACES<input type="number" aria-label="Remaining races" value={value.expectedRaces} min={0} max={40} onChange={e => onChange({...value,expectedRaces:Number(e.target.value)})}/></label>
      </div>
      <Action kind="outline" disabled={busy} onClick={() => void detectUpcoming()}>{busy ? 'Checking F1 calendar…' : 'Auto-detect upcoming races'}</Action>
      <Notice>Mid-Season · Starts R{value.openingRound} · {value.expectedRaces} Races. Future qualifying locks only; existing tournaments retain their pots and scores.</Notice>
      {value.expectedRaces > 0 && value.expectedRaces < 3 && <Notice kind="error">Only 1–2 races remain. This tournament must be free (zero entry fee).</Notice>}
      {value.expectedRaces >= 3 && value.expectedRaces < 10 && <Notice>Short mini-cup: championship picks are disabled by default. Poker auto-steepness flattens shorter seasons.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </>}
  </fieldset>;
}
