import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {SeasonScopeSettings} from './SeasonScopeSettings';
afterEach(cleanup);

/** A 12-race mid-season pool displays the signed-off 13-point bonus and 8-point penalty. */
it('shows scaled championship and salvage preview from configured race count', () => {
  render(<SeasonScopeSettings value={{openingRound:12,expectedRaces:12,championshipEnabled:true,salvageEnabled:true}} onChange={vi.fn()}/>);
  expect(screen.getByText(/\+13 points each/)).toBeTruthy();
  expect(screen.getByText(/−8 points each/)).toBeTruthy();
});

/** Switching off championship scoring also disables its dependent salvage window. */
it('automatically disables salvage for pure race-by-race tournaments', () => {
  const onChange=vi.fn();
  render(<SeasonScopeSettings value={{openingRound:17,expectedRaces:7,championshipEnabled:true,salvageEnabled:true}} onChange={onChange}/>);
  fireEvent.click(screen.getByLabelText(/Enable WDC\/WCC/));
  expect(onChange).toHaveBeenCalledWith({openingRound:17,expectedRaces:7,championshipEnabled:false,salvageEnabled:false});
});

/** Grand Prix configuration is not editable once the tournament's real first round locks. */
it('freezes all settings at the opening lock', () => {
  render(<SeasonScopeSettings locked value={{openingRound:12,expectedRaces:12,championshipEnabled:false,salvageEnabled:false}} onChange={vi.fn()}/>);
  expect((screen.getByLabelText('Opening F1 round') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Scheduled races') as HTMLInputElement).disabled).toBe(true);
});
