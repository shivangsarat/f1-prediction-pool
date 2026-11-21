import {FinancialTerms} from '../components/FinancialTerms';
import {Card, SectionHeading} from '../shared/ui';

/** Render the signed-off pool rules inside the currently selected tournament. */
export function RulesPage({season}: {season: any}) {

  return <>
    <SectionHeading eyebrow="TOURNAMENT RULEBOOK" title="Prediction rules" detail={`Season ${season.year} • ${season.sprint_mode === 'one-form' ? 'Unified sprint form' : 'Separate Sprint and Grand Prix forms'}`} />
    <div className="two-col">
      <Card><h3>Grand Prix top ten</h3><p>Predict P1 to P10 before qualifying starts.</p>
        <table><thead><tr><th>Outcome</th><th>Points</th></tr></thead><tbody>
          <tr><td>Exact P1, P2 or P3</td><td>+10 total</td></tr>
          <tr><td>Exact P4–P10</td><td>+5</td></tr>
          <tr><td>Off by one position</td><td>+3</td></tr>
          <tr><td>Off by two positions</td><td>+1</td></tr>
          <tr><td>Different podium spot, still top three</td><td>+3 bonus</td></tr>
        </tbody></table><p className="muted">Proximity still counts when a P9/P10 pick finishes P11 or P12. An exact podium match does not stack the podium-presence bonus.</p>
      </Card>
      <Card><h3>Race & Sprint props</h3><p>Pole +5, classified fastest lap +5, first official NC/retired driver +10 (ties allowed). DNS never counts as a DNF.</p>
        <p>Sprint winner +5, top constructor by Sprint points +3, and most places gained +3. Tied Sprint teams or drivers each earn full points.</p>
        <p><strong>Maximum:</strong> 85 points per Grand Prix or 96 points on a Sprint weekend.</p>
      </Card>
      <Card><h3>Season predictions · {season.opening_round > 1 ? `Mid-Season R${season.opening_round}` : 'Full Season'}</h3>
        <p>{!season.championship_enabled ? 'Pure Race-by-Race Mode: championship predictions and associated bonuses are disabled.' :
          `Correct drivers’ and constructors’ championship picks earn +${season.scope?.championshipBonus ?? 25} each.`} {' '}
          {season.salvage_enabled ? `August salvage changes cost −${season.scope?.salvagePenalty ?? 15} per category.` : 'There is no August salvage window.'}
        </p>
        <p>All forms are blind until the server-enforced UTC lock. Once locked, picks cannot be edited.</p>
      </Card>
      <Card>
        <h3>Prize distribution</h3>
        <FinancialTerms terms={season.finance ? {
          configured: true,
          payoutModel: season.finance.payoutModel,
          platformRakeBps: season.finance.platformRakeBps,
          creatorRakeBps: season.finance.creatorRakeBps,
          totalRakeBps: season.finance.platformRakeBps + season.finance.creatorRakeBps,
          pokerFloorEnabled: season.finance.pokerFloorEnabled,
          pokerItmPct: season.finance.pokerItmPct,
          configLocked: season.finance.configLocked,
          scope: season.opening_round > 1 ? 'mid' : 'full',openingRound: season.opening_round ?? 1,scheduledRaces:season.scope?.scheduledRaces ?? 0,championshipEnabled:!!season.championship_enabled,salvageEnabled:!!season.salvage_enabled,
          warning: 'Rates and payout settings freeze at this pool’s opening qualifying lock; joining another pool does not refund locked buy-ins.',
        } : undefined}/>
        {season.finance?.payoutModel === 'poker' ? (
          <p>The Casino Poker model pays a variable number of ranked finishers based on effective buy-ins and the target ITM percentage. Higher steepness concentrates rewards near first place. Floor ON reserves at least one full entry fee for each paid position. Floor OFF redistributes the entire net pot by rank, so lower paid positions may receive less than their buy-in.</p>
        ) : (
          <p>The Adaptive 3-Tier model pays up to three places: 2–3 players winner-take-all; 4–5 players 75%/25%; 6–10 players a third-place entry refund and 75%/25% of the balance; 11+ players 65%/25%/10%. An inversion safety guard applies if house rake reduces the net pot.</p>
        )}
        <p>Operator and creator house fees are deducted independently from net collected buy-ins, with a hard combined 15% cap. The remaining player pot uses exact-cent allocation. Tied places are combined and split; prorated entrants have capped eligibility. No prize may exceed collected funds.</p>
      </Card>
    </div>
  </>;
}
