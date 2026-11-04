import { describe, expect, it } from 'vitest';
import { getHkClock, isLoginHoursOpen } from '../loginHours';

/** Build a Date whose Asia/Hong_Kong wall time matches the given parts. */
function hkInstant(y: number, m: number, d: number, hh: number, mm: number): number {
  // HKT = UTC+8, no DST
  return Date.UTC(y, m - 1, d, hh - 8, mm, 0);
}

describe('loginHours', () => {
  it('opens at 07:00 HKT and closes at 23:00 HKT', () => {
    expect(isLoginHoursOpen(hkInstant(2026, 11, 3, 6, 59))).toBe(false);
    expect(isLoginHoursOpen(hkInstant(2026, 11, 3, 7, 0))).toBe(true);
    expect(isLoginHoursOpen(hkInstant(2026, 11, 3, 14, 30))).toBe(true);
    expect(isLoginHoursOpen(hkInstant(2026, 11, 3, 22, 59))).toBe(true);
    expect(isLoginHoursOpen(hkInstant(2026, 11, 3, 23, 0))).toBe(false);
    expect(isLoginHoursOpen(hkInstant(2026, 11, 3, 0, 15))).toBe(false);
  });

  it('reports HKT clock parts', () => {
    const c = getHkClock(hkInstant(2026, 11, 3, 14, 26));
    expect(c.date).toBe('2026-11-03');
    expect(c.hour).toBe(14);
    expect(c.minute).toBe(26);
    expect(c.timeLabel).toBe('14:26');
  });
});
