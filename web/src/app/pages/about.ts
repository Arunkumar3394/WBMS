import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../shared/ui';
import { Testimonials } from '../shared/testimonials';

// Edit the text below to tell your own story (when you started, who you serve, your team).
@Component({
  selector: 'app-about',
  imports: [RouterLink, PageHeader, Testimonials],
  template: `
    <app-page-header eyebrow="About us" title="About AquaPure Water"
      intro="We supply purified drinking water in 20-litre cans and packaged bottles, delivered to homes, offices, shops, hotels and events." />

    <div class="container-page grid gap-12 py-12 lg:grid-cols-2">
      <div class="space-y-5 text-slate-700">
        <h2 class="text-2xl">What we do</h2>
        <p>
          AquaPure Water treats drinking water at our RO purification plant and fills it into returnable 20-litre cans and
          sealed bottles. Our delivery team brings the water to your door in the slot you choose and collects your empty cans.
        </p>
        <p>
          Families order cans for their home dispensers, offices and shops set up regular deliveries, and organisers order
          bottled water in bulk for functions and events.
        </p>
        <h2 class="pt-4 text-2xl">How we work</h2>
        <ul class="space-y-3">
          <li><strong class="text-brand-900">Clear prices.</strong> You see the full amount, including any delivery charge or refundable can deposit, before you pay.</li>
          <li><strong class="text-brand-900">Reliable slots.</strong> Each delivery slot takes a limited number of orders, so we can keep to the time you choose.</li>
          <li><strong class="text-brand-900">Easy to reach.</strong> Message us on WhatsApp or send an enquiry for anything you need.</li>
        </ul>
        <div class="flex flex-wrap gap-3 pt-4">
          <a routerLink="/products" class="btn-primary">See our products</a>
          <a routerLink="/contact" class="btn-secondary">Contact us</a>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4 self-start">
        <img src="/images/water-plant/ro-plant-steel.webp" alt="Reverse osmosis purification equipment" width="600" height="600"
             class="col-span-2 w-full rounded-3xl bg-white object-cover shadow-md" loading="lazy" />
        <img src="/images/water-plant/bottling-line.webp" alt="Bottles on a filling line" width="458" height="290"
             class="h-full w-full rounded-3xl object-cover shadow-md" loading="lazy" />
        <img src="/images/water-plant/ro-plant-filters.webp" alt="Water filter tanks" width="480" height="320"
             class="h-full w-full rounded-3xl object-cover shadow-md" loading="lazy" />
      </div>
    </div>

    <app-testimonials />
  `,
})
export class About {}
