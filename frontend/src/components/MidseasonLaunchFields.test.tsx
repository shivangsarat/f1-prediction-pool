import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MidseasonLaunchFields} from './MidseasonLaunchFields';
import {get} from '../api';
vi.mock('../api', () => ({get: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

/** Creators can switch from full-season to mid-season without touching other tournaments. */
it('switches tournament scope into the future-round launch workflow', () => {
  const onChange = vi.fn();
  render(<MidseasonLaunchFields value={{year:2028,openingRound:1,expectedRaces:24}} onChange={onChange}/>);
  fireEvent.change(screen.getByLabelText('Launch mode'), {target:{value:'mid'}});
  expect(onChange).toHaveBeenCalledWith({year:2028,openingRound:2,expectedRaces:0});
});

/** Show the no-paid-entry guard for one- or two-race mini-cups. */
it('discloses the free-only warning for short launches', () => {
  render(<MidseasonLaunchFields value={{year:2028,openingRound:23,expectedRaces:2}} onChange={vi.fn()}/>);
  expect(screen.getByText(/zero entry fee/)).toBeTruthy();
});

/** Calendar detection reads the shared OpenF1 cache and preserves the actual real-world round. */
it('auto-detects upcoming rounds without changing the server calendar', async () => {
  vi.mocked(get).mockResolvedValue({year:2028,openingRound:12,expectedRaces:12,scope:'mid',upcomingOnly:true});
  const onChange=vi.fn();
  render(<MidseasonLaunchFields value={{year:2028,openingRound:2,expectedRaces:0}} onChange={onChange}/>);
  fireEvent.click(screen.getByRole('button',{name:'Auto-detect upcoming races'}));
  await waitFor(()=>expect(onChange).toHaveBeenCalledWith({year:2028,openingRound:12,expectedRaces:12}));
});
