import { TestBed } from '@angular/core/testing';
import { CartService } from './cart.service';
import { Product } from './models';

const product = (over: Partial<Product> = {}): Product => ({
  id: 1, slug: 'can', name: '20 L Water Can', short_description: null, unit_label: '20 L can', price: 40,
  is_sample_price: true, is_returnable_can: true, deposit_amount: 150, min_order_qty: 1, max_order_qty: 30,
  image_path: null, image_url: null, in_stock: true, category_id: 1, category_slug: 'water-cans', ...over,
});

describe('CartService', () => {
  let cart: CartService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    cart = TestBed.inject(CartService);
  });

  it('adds products and merges repeat adds', () => {
    cart.add(product(), 2);
    cart.add(product(), 3);
    expect(cart.lines().length).toBe(1);
    expect(cart.count()).toBe(5);
    expect(cart.subtotal()).toBe(200);
  });

  it('keeps quantities within the product limits', () => {
    cart.add(product({ min_order_qty: 2, max_order_qty: 5 }), 1);
    expect(cart.lines()[0].quantity).toBe(2);
    cart.setQuantity(1, 99);
    expect(cart.lines()[0].quantity).toBe(5);
    cart.setQuantity(1, -3);
    expect(cart.lines()[0].quantity).toBe(2);
  });

  it('refreshes prices and drops products no longer sold or out of stock', () => {
    cart.add(product(), 2);
    cart.add(product({ id: 2, slug: 'b', price: 180 }), 1);
    cart.add(product({ id: 3, slug: 'c' }), 1);
    cart.sync([product({ price: 45 }), product({ id: 2, slug: 'b', price: 180, in_stock: false })]);
    expect(cart.lines().map((l) => l.product_id)).toEqual([1]);
    expect(cart.subtotal()).toBe(90);
  });

  it('removes and clears', () => {
    cart.add(product(), 1);
    cart.add(product({ id: 2, slug: 'b' }), 1);
    cart.remove(1);
    expect(cart.lines().map((l) => l.product_id)).toEqual([2]);
    cart.clear();
    expect(cart.count()).toBe(0);
  });

  it('survives corrupt saved data', () => {
    localStorage.setItem('aquapure.cart.v1', '{not json');
    TestBed.resetTestingModule();
    expect(TestBed.inject(CartService).lines()).toEqual([]);
  });
});
