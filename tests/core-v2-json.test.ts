import { describe, expect, it } from 'vitest';
import { canonicalJson, hashJson } from '../src/core/v2/json.js';

describe('canonicalJson', () => {
  it('gives objects with different key insertion order the same representation', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
  });

  it('keeps array order significant', () => {
    expect(hashJson(['a', 'b'])).not.toBe(hashJson(['b', 'a']));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, undefined])(
    'rejects a non-JSON value: %s',
    (value) => expect(() => canonicalJson(value as never)).toThrow(),
  );

  it('rejects sparse arrays instead of converting holes to null', () => {
    const sparse = Array(2) as never;
    expect(() => canonicalJson(sparse)).toThrow('sparse');
  });
});
