import {Notice, FieldHelp} from '../shared/ui';
import {postAugustMidseason} from './seasonDates';

/** Server-persisted opening-round policy selected by the commissioner before qualifying locks. */
export type SeasonScopeFields = {
  openingRound: number;
  expectedRaces: number;
  championshipEnabled: boolean;
  salvageEnabled: boolean;
};

/** Show race-count-based championship scaling and conditional August salvage rules. */
export function SeasonScopeSettings({value, onChange, locked, seasonYear}: {
  value: SeasonScopeFields; onChange: (next: SeasonScopeFields) => void; locked?: boolean; seasonYear?: number;
}) {
  const mid = value.openingRound > 1;
  const bonus = mid ? Math.round(25 * value.expectedRaces / 24) : 25;
  const penalty = mid ? Math.round(15 * value.expectedRaces / 24) : 15;
  const warnPaid = mid && value.expectedRaces < 3;
  const pastAugust = seasonYear !== undefined && postAugustMidseason(seasonYear, value.openingRound);

  /** Change independent options while clearing salvage when championship picks are turned off. */
  function patch(next: Partial<SeasonScopeFields>) {
    const merged = {...value,...next};
    if (!merged.championshipEnabled || (seasonYear !== undefined && postAugustMidseason(seasonYear, merged.openingRound))) merged.salvageEnabled = false;
    if (merged.openingRound > 1 && (merged.expectedRaces < 10 || (seasonYear !== undefined && postAugustMidseason(seasonYear, merged.openingRound)))) {
      merged.championshipEnabled = false;
      merged.salvageEnabled = false;
    }
    onChange(merged);
  }

  return <fieldset className="season-scope-settings" aria-label="Season scope settings">
    <legend className="divider-title">Races and season winner predictions</legend>
    <div className="form-grid">
      <label className="input-label">First eligible F1 round<FieldHelp label="First eligible F1 round" detail="The actual F1 championship round when this competition starts; earlier rounds are excluded."/>
        <input type="number" aria-label="Opening F1 round" min={1} max={40} disabled={locked} value={value.openingRound} onChange={e => patch({openingRound:Number(e.target.value)})}/>
      </label>
      <label className="input-label">Races in this tournament<FieldHelp label="Races in this tournament" detail="How many real F1 races this pool covers, including its opening round. Short pools may need a free entry fee."/>
        <input type="number" aria-label="Scheduled races" min={0} max={40} disabled={locked} value={value.expectedRaces} onChange={e => patch({expectedRaces:Number(e.target.value)})}/>
      </label>
    </div>
    <label className="check-line"><input type="checkbox" disabled={locked || pastAugust || (mid && value.expectedRaces < 10)} checked={value.championshipEnabled} onChange={e => patch({championshipEnabled:e.target.checked})}/> Score season winner predictions<FieldHelp label="Score season winner predictions" detail="Enable points for correctly predicting the Drivers’ and Constructors’ World Champions. Late-season tournaments cannot enable this."/></label>
    <label className="check-line"><input type="checkbox" disabled={locked || !value.championshipEnabled || pastAugust} checked={value.salvageEnabled} onChange={e => patch({salvageEnabled:e.target.checked})}/> Allow August winner-pick changes<FieldHelp label="Allow August winner-pick changes" detail="Allow one August seven-day period to revise season champion picks for a points penalty; unavailable after August or when championship scoring is off."/></label>
    <Notice>{mid ? `Mid-Season · Starts R${value.openingRound} · ${value.expectedRaces} Races.` : 'Full Season.'}
      {' '}{value.championshipEnabled ? `Correct championship picks earn +${bonus} points each.` : 'Pure Race-by-Race Mode — no championship bonuses.'}
      {' '}{value.salvageEnabled ? `Changed picks cost −${penalty} points each after August salvage.` : 'August salvage is disabled.'}
    </Notice>
    {pastAugust && <Notice>After August, a new mid-season pool uses pure race-by-race scoring. Championship picks and salvage are unavailable; no August dates are needed.</Notice>}
    {warnPaid && <Notice kind="error">Fewer than three races remain. Only free/fun tournaments with a zero entry fee can launch.</Notice>}
    {mid && value.expectedRaces < 10 && value.championshipEnabled && <Notice kind="error">Mid-season championship picks need at least 10 pre-August races. Switch to Pure Race-by-Race Mode.</Notice>}
  </fieldset>;
}
