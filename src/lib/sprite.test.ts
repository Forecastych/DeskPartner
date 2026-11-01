import { describe, expect, it } from 'vitest';
import { hitMask, IDLE, SIZE } from './sprite';

describe('hitMask', () => {
  it('ставит бит x там, где нарисован пиксель', () => {
    const frame = Array(SIZE).fill('.'.repeat(SIZE));
    frame[3] = 'k' + '.'.repeat(SIZE - 2) + 'k';
    const mask = hitMask(frame);
    expect(mask[3]).toBe(0x8000_0001);
    expect(mask[0]).toBe(0);
  });

  it('каждый кадр заглушки — квадрат SIZE×SIZE и не пустой', () => {
    for (const f of IDLE) {
      expect(f).toHaveLength(SIZE);
      expect(f.every((r) => r.length === SIZE)).toBe(true);
      expect(hitMask(f).some((r) => r !== 0)).toBe(true);
    }
  });
});
