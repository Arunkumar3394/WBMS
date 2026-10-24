import { safeReturnUrl } from './auth.guard';

describe('safeReturnUrl', () => {
  it('keeps paths on this site', () => {
    expect(safeReturnUrl('/checkout')).toBe('/checkout');
    expect(safeReturnUrl('/products?category=water-cans')).toBe('/products?category=water-cans');
  });

  it('refuses links to other websites and falls back to the account page', () => {
    for (const bad of ['//evil.example.com', '/\\evil.example.com', 'https://evil.example.com', 'javascript:alert(1)', '', null, undefined]) {
      expect(safeReturnUrl(bad)).toBe('/account');
    }
  });
});
