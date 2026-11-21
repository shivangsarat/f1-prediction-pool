import React from 'react';
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
      <Card><h3>Season predictions</h3><p>Preseason drivers' and constructors' champions earn +25 each. During the one-week August salvage window, changing a pick costs −15 points per category.</p>
        <p>All forms are blind until the server-enforced UTC lock. Once locked, picks cannot be edited.</p>
      </Card>
      <Card><h3>Prize distribution</h3><p>For 2–3 paying players, first takes the pool; for 4–5 players, first/second receive 75%/25%. For 6–10 players, third receives one base entry refund and the remainder splits 75%/25%. For 11+, the split is 65%/25%/10%.</p>
        <p>Buy-ins and refunds are tracked in an auditable ledger, and prorated entrants have capped eligibility. Payouts never exceed collected funds.</p>
      </Card>
    </div>
  </>;
}
