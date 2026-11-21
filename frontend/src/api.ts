const PREFIX = '/api';

/** Typed error representation for server API failures. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status
  }
}

/** Perform same-origin cookie-authenticated JSON requests without exposing the session token. */
export async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {

  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(PREFIX + path, {...options, credentials: 'same-origin', headers});
  let data: any;
  try {
    data = await response.json()
  } catch {
    throw new ApiError(response.status, 'Unexpected server response')
  }
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data as T;
}

/** Read tournament-scoped API data. */
export const get = <T = any>(path: string) => request<T>(path);
/** Create a scoped resource or execute a controlled action. */
export const post = <T = any>(path: string, body: unknown) => request<T>(path, {method: 'POST', body: JSON.stringify(body)});
/** Submit a full immutable prediction revision. */
export const put = <T = any>(path: string, body: unknown) => request<T>(path, {method: 'PUT', body: JSON.stringify(body)});
/** Update a commissioner-controlled configuration field. */
export const patch = <T = any>(path: string, body: unknown) => request<T>(path, {method: 'PATCH', body: JSON.stringify(body)});
/** Display integer cents in the tournament's configured currency. */
export const money = (c: number, currency = 'EUR') => new Intl.NumberFormat('en-IE', {style: 'currency', currency}).format((c ?? 0) / 100);
/** Display UTC event dates in the browser's local time zone. */
export const date = (iso: string) => iso ? new Date(iso).toLocaleString(undefined, {weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'}) : '—';
