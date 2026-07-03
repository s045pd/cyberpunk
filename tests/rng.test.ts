import { describe, it, expect } from 'vitest';
import { createRng, range, rangeInt, pick } from '../src/core/rng';

describe('createRng', () => {
  it('相同种子产生相同序列', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  it('输出始终落在 [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('辅助函数', () => {
  it('range 输出在 [min, max)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const v = range(rng, 5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(9);
    }
  });

  it('rangeInt 覆盖闭区间端点', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rangeInt(rng, 1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('pick 只返回数组内元素', () => {
    const rng = createRng(5);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(rng, arr));
  });
});
