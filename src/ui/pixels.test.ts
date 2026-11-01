import { describe, expect, it } from 'vitest';
import { gridOf, ICONS, pixelPath } from './pixels';

describe('pixelPath', () => {
  it('сливает соседние клетки строки в один прямоугольник', () => {
    expect(pixelPath(['###'])).toBe('M0 0h3v1h-3z');
  });

  it('разрывы и пустые строки дают отдельные куски', () => {
    expect(pixelPath(['#.#', '...', '.##'])).toBe('M0 0h1v1h-1zM2 0h1v1h-1zM1 2h2v1h-2z');
  });

  it('пустой рисунок — пустой путь', () => {
    expect(pixelPath(['...', ''])).toBe('');
  });
});

describe('ICONS', () => {
  it('у каждого значка строки одной длины', () => {
    for (const [name, rows] of Object.entries(ICONS)) {
      const { w } = gridOf(rows);
      expect(rows.every((r) => r.length === w), name).toBe(true);
    }
  });
});
