import { describe, expect, it } from 'vitest';
import { linePoints } from './PriceLine';

describe('linePoints', () => {
  it('places the points by date and price, the highest at the top', () => {
    const points = [
      { date: '2026-10-01', cents: 500, lang: 'en' },
      { date: '2026-10-02', cents: 700, lang: 'en' },
      { date: '2026-10-05', cents: 600, lang: 'en' },
    ];
    expect(linePoints(points, 400, 100)).toBe('0,100 100,0 400,50');
  });

  it('draws a flat series through the middle and nothing for fewer than two points', () => {
    const flat = [
      { date: '2026-10-01', cents: 675, lang: 'en' },
      { date: '2026-10-03', cents: 675, lang: 'en' },
    ];
    expect(linePoints(flat, 200, 120)).toBe('0,60 200,60');
    expect(linePoints([{ date: '2026-10-01', cents: 675, lang: 'en' }])).toBe('');
    expect(linePoints([])).toBe('');
  });
});
