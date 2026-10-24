import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Product } from '../core/models';
import { ProductCard } from '../shared/product-card';
import { Testimonials } from '../shared/testimonials';

@Component({
  selector: 'app-home',
  imports: [RouterLink, ProductCard, Testimonials],
  templateUrl: './home.html',
})
export class Home implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly featured = signal<Product[]>([]);

  protected readonly highlights = [
    { title: 'RO purified water', text: 'Drinking water treated at our RO purification plant before it is filled.' },
    { title: 'Delivery slots', text: 'Choose a morning, midday or evening slot that suits you.' },
    { title: 'Pay your way', text: 'Pay online when you order, or in cash when the water arrives.' },
    { title: 'Homes to events', text: 'From a single can at home to bulk bottles for a function.' },
  ];

  protected readonly steps = [
    { title: 'Choose your water', text: '20-litre cans or cases of bottled water, in the quantity you need.' },
    { title: 'Pick a delivery slot', text: 'Enter your address and choose a date and time window.' },
    { title: 'We deliver', text: 'Track your order from confirmed to delivered in your account.' },
  ];

  async ngOnInit() {
    try {
      const catalog = await this.api.catalog();
      this.featured.set(catalog.products.slice(0, 3));
    } catch {
      // The products section is hidden if the catalog cannot be loaded; the rest of the page still works.
    }
  }
}
