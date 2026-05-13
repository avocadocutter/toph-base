import { describe, it, expect } from 'vitest';
import { parseQueryParams } from './query-parser.js';
import { BadRequestError } from '../../lib/errors.js';

describe('parseQueryParams', () => {
  it('throws BadRequestError when filter operator is not in the allowed list', () => {
    expect(() =>
      parseQueryParams({ name: 'contains.Smith' }),
    ).toThrow(BadRequestError);

    expect(() =>
      parseQueryParams({ name: 'contains.Smith' }),
    ).toThrow('Invalid filter operator: contains');
  });

  it('throws BadRequestError when or() contains a nested and() or or() group', () => {
    expect(() =>
      parseQueryParams({ or: '(and(status.eq.active,role.eq.admin))' }),
    ).toThrow(BadRequestError);

    expect(() =>
      parseQueryParams({ or: '(or(status.eq.active,status.eq.pending))' }),
    ).toThrow(BadRequestError);
  });

  it('parses not.op.value negation with negate:true and correct operator and value', () => {
    const result = parseQueryParams({ name: 'not.eq.Smith' });
    expect(result.filters).toHaveLength(1);
    const filter = result.filters[0];
    expect(filter.column).toBe('name');
    expect(filter.operator).toBe('eq');
    expect(filter.value).toBe('Smith');
    expect(filter.negate).toBe(true);
  });

  it('throws BadRequestError when not. prefix is present but the inner operator is invalid', () => {
    expect(() =>
      parseQueryParams({ name: 'not.contains.Smith' }),
    ).toThrow(BadRequestError);
  });

  it('clamps limit to 1000 when a larger value is requested', () => {
    const result = parseQueryParams({ limit: '5000' });
    expect(result.limit).toBe(1000);
  });

  it('throws BadRequestError for a negative limit', () => {
    expect(() =>
      parseQueryParams({ limit: '-1' }),
    ).toThrow(BadRequestError);
  });

  it('throws BadRequestError for a non-numeric limit', () => {
    expect(() =>
      parseQueryParams({ limit: 'all' }),
    ).toThrow(BadRequestError);
  });
});
