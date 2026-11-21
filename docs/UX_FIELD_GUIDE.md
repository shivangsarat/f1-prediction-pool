# GRIDLOCK — clearer settings and contextual help

All user-facing field names use plain English; **backend request/response keys and stored values are unchanged** to preserve API compatibility. The small circled **i** beside a field or switch opens an exact explanation on click, tap or keyboard activation. Click it again (or press Escape when focused) to dismiss. Help never saves or toggles a configuration value.

## Quick vocabulary

| UI wording | Stored API key | Meaning |
| --- | --- | --- |
| Tournament access | `visibility` | Public: catalogue **and** invitations. Invite-only: invitations only. |
| Tournament start | `openingRound` | First real F1 round covered; earlier rounds are excluded. |
| Races left in competition | `expectedRaces` | Number of eligible upcoming races. |
| Score season winner predictions | `championshipEnabled` | Whether correct WDC/WCC predictions award points. |
| Allow August winner-pick changes | `salvageEnabled` | Optional seven-day August revision window with a points penalty. |
| Prize distribution model | `payoutModel` | Classic Top 3 or Poker-style prize places. |
| Platform fee / creator fee (basis points) | `platformRakeBps`, `houseRakeBps` | 100 basis points equals 1%; combined cap is 15%. |
| Guarantee paid players recover their entry | `pokerFloorEnabled` | Poker floor option; changes count of paid places. |
| Players receiving prizes (%) | `pokerItmPct` | Target percentage of entrants paid in Poker mode. |
| Prize curve | `pokerAlphaMode` | Auto or manually controlled prize steepness. |
| Entry fee (in cents) | `baseEntryCents` | Integer-cent fee recorded by the commissioner, never charged by GRIDLOCK. |

Other configuration screens use the same consistent help control. Prediction fields explain FIA scoring terms (pole, fastest lap, first DNF, Sprint props). Account settings explain email privacy and verification. Emergency ballot fields explicitly describe the pre-lock evidence requirement. No toggle description overrides server-side eligibility or deadline checks.

The flag shown in the browser title/tab and app branding is a **vector SVG** at `frontend/public/gridlock-flag.svg`; it is not a cropped screenshot or embedded raster and scales cleanly to browser icon sizes.
