/**
 * Login window: daily 07:00–23:00 Asia/Hong_Kong (open [7:00, 23:00)).
 * Keep in sync with src/auth/loginHours.ts.
 */

export const LOGIN_TZ = 'Asia/Hong_Kong';
export const LOGIN_OPEN_HOUR = 7;
export const LOGIN_CLOSE_HOUR = 23;

export const MAINTENANCE_MSG =
  '系統維護，未能登入。開放時間：每日上午 7 時至下午 11 時（香港時間）。';

export interface HkClock {
  hour: number;
  minute: number;
  date: string;
  timeLabel: string;
}

export function getHkClock(now = Date.now()): HkClock {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOGIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const timeLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { hour, minute, date, timeLabel };
}

export function isLoginHoursOpen(now = Date.now()): boolean {
  const { hour, minute } = getHkClock(now);
  const mins = hour * 60 + minute;
  return mins >= LOGIN_OPEN_HOUR * 60 && mins < LOGIN_CLOSE_HOUR * 60;
}
