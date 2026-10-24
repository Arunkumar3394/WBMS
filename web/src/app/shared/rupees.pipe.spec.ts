import { formatRupees } from './rupees.pipe';

describe('formatRupees', () => {
  it('shows whole rupees without decimals and paise with two', () => {
    expect(formatRupees(40)).toBe('₹40');
    expect(formatRupees(175.5)).toBe('₹175.50');
  });

  it('groups thousands the Indian way', () => {
    expect(formatRupees(125000)).toBe('₹1,25,000');
  });

  it('accepts numeric strings and ignores bad values', () => {
    expect(formatRupees('80.00')).toBe('₹80');
    expect(formatRupees(null)).toBe('');
    expect(formatRupees('abc')).toBe('');
  });
});
