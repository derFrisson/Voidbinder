export type LogLevel = 'info' | 'warn' | 'error';

/** One JSON line per event; Workers Logs (observability) indexes the fields. */
export function log(level: LogLevel, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
