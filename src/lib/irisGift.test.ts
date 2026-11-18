import { describe, expect, it } from 'vitest';
import { animsFor } from './growth';
import { BOX_PALETTE, revealFrames, waitingFrame } from './irisGift';
import { hitMask, PALETTE, SIZE } from './sprite';

describe('подарочная коробка', () => {
  it('шевелится, остаётся у края и принимает клики только по рисунку', () => {
    const still = waitingFrame(0);
    const raised = waitingFrame(100);
    expect(raised).not.toEqual(still);
    expect(raised[SIZE - 1]).toBe(still[SIZE - 1]);
    const mask = hitMask(still);
    expect(mask[0]).toBe(0);
    expect(mask[27] & (1 << 16)).not.toBe(0);
    expect(mask[27] & 1).toBe(0);
  });

  it('открывается и заканчивается кадром питомца с рамкой', () => {
    const kit = animsFor(0, 0);
    const pose = kit.sit.frames[0];
    const frames = revealFrames({ idle: pose, happy: kit.petted.frames[0] });
    const palette = { ...PALETTE, ...BOX_PALETTE };
    expect(frames[0].join('')).toContain('J');
    expect(frames.at(-1)?.[25].slice(1, 9)).toBe('KJJJJJJK');
    for (const frame of frames) {
      expect(frame).toHaveLength(SIZE);
      for (const row of frame) {
        expect(row).toHaveLength(SIZE);
        expect([...row].every((pixel) => pixel === '.' || pixel in palette)).toBe(true);
      }
    }
  });
});
