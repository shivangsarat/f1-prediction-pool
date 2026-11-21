import React, {useEffect, useState} from 'react';
import {CheckCircle2, Info, RefreshCw} from 'lucide-react';

export type View = 'overview' | 'picks' | 'standings' | 'ledger' | 'championship' | 'rules' | 'admin';
export type Form = 'gp' | 'sprint' | 'unified';
/** Compare display codes independently of punctuation/case. */
export const slug = (x: string) => x.toLowerCase().replace(/[^a-z\d]/g, '');
/** Build an initial GP ballot from the active tournament's registered drivers. */
export const mkDefault = (drivers: any[]) => ({top10: drivers.slice(0, 10).map(d => d.id), props: {pole: drivers[0]?.id ?? '', fastestLap: drivers[0]?.id ?? '', firstDnf: drivers[0]?.id ?? ''}});
/** Build an initial sprint ballot from active drivers and teams. */
export const emptySprint = (drivers: any[], teams: any[]) => ({winner: drivers[0]?.id ?? '', teamMostPoints: teams[0]?.id ?? '', mostGained: drivers[0]?.id ?? ''});
/** Derive a live client-side visual countdown; the server remains authoritative for lock enforcement. */
export function useCountdown(iso?: string) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const x = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(x)
  }, []);
  if (!iso) return {text: '—', closed: true};
  const left = Date.parse(iso) - tick;
  if (left <= 0) return {text: 'LOCKED', closed: true};
  const days = Math.floor(left / 86400000), hours = Math.floor(left / 3600000) % 24, min = Math.floor(left / 60000) % 60, sec = Math.floor(left / 1000) % 60;
  return {text: `${days ? days + 'd ' : ''}${String(hours).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`, closed: false}
}
/** Present accessible status/error feedback. */
export function Notice({kind = 'info', children}: {kind?: 'error' | 'info' | 'success'; children: React.ReactNode}) {
  return <div className={'notice ' + kind}>{kind === 'error' ? <Info size={17} /> : <CheckCircle2 size={17} />}<span>{children}</span></div>
}
/** Render a compact categorical status pill. */
export function Pill({children, tone = 'muted'}: {children: React.ReactNode; tone?: 'muted' | 'red' | 'green' | 'amber'}) {
  return <span className={'pill ' + tone}>{children}</span>
}
/** Render a dashboard statistic consistently. */
export function Metric({label, value, sub, icon: Icon}: {label: string; value: React.ReactNode; sub?: string; icon?: any}) {
  return <div className="metric"><div className="metric-head"><span>{label}</span>{Icon && <Icon size={18} />}</div><div className="metric-value">{value}</div><div className="metric-sub">{sub ?? ' '}</div></div>
}
/** Present standard page headings and optional actions. */
export function SectionHeading({eyebrow, title, detail, right}: {eyebrow: string; title: string; detail?: string; right?: React.ReactNode}) {
  return <div className="section-heading"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{detail && <p className="muted">{detail}</p>}</div>{right && <div>{right}</div>}</div>
}
/** Wrap a visually grouped, reusable dashboard section. */
export function Card({children, className = ''}: {children: React.ReactNode; className?: string}) {
  return <section className={'panel ' + className}>{children}</section>
}
/** Render a controlled typed option selector. */
export function Select({value, onChange, options, placeholder = 'Select...', disabled = false}: {value: string; onChange: (x: string) => void; options: {value: string; label: string}[]; placeholder?: string; disabled?: boolean}) {
  return <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="" disabled>{placeholder}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
}
/** Render a labeled controlled input field. */
export function TextInput({label, value, onChange, placeholder = '', type = 'text', disabled = false}: {label: string; value: string; onChange: (x: string) => void; placeholder?: string; type?: string; disabled?: boolean}) {
  return <label className="input-label">{label}<input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type} disabled={disabled} /></label>
}
/** Render a consistent form or toolbar action with loading state. */
export function Action({children, onClick, disabled = false, kind = 'primary', loading = false, type = 'button'}: {children: React.ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'outline' | 'ghost' | 'danger'; loading?: boolean; type?: 'submit' | 'button'}) {
  return <button type={type} className={'btn ' + kind} onClick={onClick} disabled={disabled || loading}>{loading ? <RefreshCw size={16} className="spin" /> : null}{children}</button>
}
