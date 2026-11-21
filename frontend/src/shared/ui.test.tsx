import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {Action, Card, FieldHelp, Metric, Notice, Pill, Select, TextInput, emptySprint, mkDefault, slug} from './ui';

afterEach(cleanup);

/** Exercise pure ballot constructors with tournament-specific driver rosters. */
describe('prediction field helpers', () => {

  it('normalizes display codes', () => expect(slug('McLaren #4')).toBe('mclaren4'));
  it('creates default GP selections from exactly the first ten drivers', () => {

    const drivers = Array.from({length: 12}, (_, i) => ({id: `${i + 1}`}));
    expect(mkDefault(drivers).top10).toEqual(drivers.slice(0, 10).map(driver => driver.id));
    expect(mkDefault(drivers).props).toEqual({pole: '1', fastestLap: '1', firstDnf: '1'});
  });
  it('creates sprint selections for the current team roster', () => {

    expect(emptySprint([{id: '1'}], [{id: 'mclaren'}])).toEqual({winner: '1', mostGained: '1', teamMostPoints: 'mclaren'});
  });
});

/** Verify that reusable UI components expose correct semantics and input callbacks. */
describe('shared controls', () => {

  it('renders a status message and optional visual label', () => {

    render(<><Notice kind="success">Saved</Notice><Pill tone="green">Ready</Pill></>);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  it('renders card and metric content', () => {

    render(<Card><Metric label="Score" value={25} sub="points" /></Card>);
    expect(screen.getByText('Score')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
  });
  it('calls controlled field callbacks', () => {

    const onInput = vi.fn(), onSelect = vi.fn();
    render(<><TextInput label="Tournament" value="" onChange={onInput} /><Select value="a" onChange={onSelect} options={[{value: 'a', label: 'A'}, {value: 'b', label: 'B'}]} /></>);
    fireEvent.change(screen.getByRole('textbox', {name: 'Tournament'}), {target: {value: 'Round'}});
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'b'}});
    expect(onInput).toHaveBeenCalledWith('Round');
    expect(onSelect).toHaveBeenCalledWith('b');
  });
  it('disables actions while a transaction is pending', () => {

    const click = vi.fn();
    render(<Action onClick={click} loading>Commit</Action>);
    fireEvent.click(screen.getByRole('button', {name: 'Commit'}));
    expect(click).not.toHaveBeenCalled();
  });
});

/** Help is opt-in, accessible, and dismissible without mutating the field. */
it('opens and closes an accessible field explanation on request', () => {
  render(<TextInput label="BASE ENTRY (CENTS)" value="1000" onChange={vi.fn()} />);
  const trigger = screen.getByRole('button', {name: /About Entry fee/i});
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('status').textContent).toContain('1000 cents means');
  fireEvent.click(trigger);
  expect(screen.queryByRole('status')).toBeNull();
});

/** A help trigger on a toggle should never accidentally toggle the parent checkbox. */
it('explains a toggle without changing its state', () => {
  const onChange = vi.fn();
  render(<label><input type="checkbox" onChange={onChange}/>Charge a fee
    <FieldHelp label="Fee" detail="Fee deducted from buy-ins."/>
  </label>);
  fireEvent.click(screen.getByRole('button', {name: 'About Fee'}));
  expect(screen.getByText('Fee deducted from buy-ins.')).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
