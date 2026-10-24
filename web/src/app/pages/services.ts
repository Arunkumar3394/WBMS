import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EnquiryType } from '../core/models';
import { PageHeader } from '../shared/ui';

interface Service {
  id: string;
  title: string;
  text: string;
  points: string[];
  image?: { src: string; alt: string; width: number; height: number };
  cta: { label: string; link: string; type?: EnquiryType };
}

@Component({
  selector: 'app-services',
  imports: [RouterLink, PageHeader],
  template: `
    <app-page-header eyebrow="Services" title="Water delivery for every need"
      intro="Whether you need one can at home or regular supply for an office, shop or hotel, we deliver on a schedule that suits you." />

    <div class="container-page space-y-16 py-12">
      @for (s of services; track s.id; let odd = $odd) {
        <section [id]="s.id" class="grid items-center gap-8 lg:grid-cols-2" [attr.aria-labelledby]="s.id + '-title'">
          <div [class.lg:order-2]="odd">
            <h2 [id]="s.id + '-title'" class="text-2xl sm:text-3xl">{{ s.title }}</h2>
            <p class="mt-3 text-slate-600">{{ s.text }}</p>
            <ul class="mt-5 space-y-2">
              @for (pt of s.points; track pt) {
                <li class="flex gap-3">
                  <svg class="mt-1 h-4 w-4 shrink-0 text-aqua-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" />
                  </svg>
                  <span>{{ pt }}</span>
                </li>
              }
            </ul>
            <a [routerLink]="s.cta.link" [queryParams]="s.cta.type ? { type: s.cta.type } : {}" class="btn-primary mt-6">{{ s.cta.label }}</a>
          </div>
          @if (s.image; as img) {
            <img [src]="img.src" [alt]="img.alt" [width]="img.width" [height]="img.height" loading="lazy"
                 class="w-full rounded-3xl object-cover shadow-md" [class.lg:order-1]="odd" />
          } @else {
            <div class="flex aspect-[4/3] items-center justify-center rounded-3xl bg-gradient-to-br from-aqua-50 to-brand-100" [class.lg:order-1]="odd" aria-hidden="true">
              <svg viewBox="0 0 64 64" class="h-24 w-24 text-brand-500" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M4 40V22h30v18M34 28h12l8 8v4H34" stroke-linejoin="round" />
                <circle cx="16" cy="44" r="5" /><circle cx="46" cy="44" r="5" />
              </svg>
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class Services {
  protected readonly services: Service[] = [
    {
      id: 'home-delivery',
      title: 'Home delivery',
      text: 'Order 20-litre cans or bottled water online and choose a delivery slot. We bring full cans and collect your empty ones.',
      points: ['One-time orders whenever you need water', 'Morning, midday and evening slots', 'Pay online or cash on delivery'],
      image: { src: '/images/water-cans/can-on-dispenser.webp', alt: 'A 20-litre water can on a home water dispenser', width: 300, height: 376 },
      cta: { label: 'Order for home', link: '/products' },
    },
    {
      id: 'office-supply',
      title: 'Office and shop supply',
      text: 'Keep your office, shop, clinic or hotel stocked with regular deliveries of 20-litre cans and bottled water.',
      points: ['Scheduled deliveries on fixed days', 'Office packs of five cans', 'One contact for all your orders'],
      cta: { label: 'Ask about office supply', link: '/contact', type: 'office_supply' },
    },
    {
      id: 'bulk-orders',
      title: 'Bulk and event orders',
      text: 'Weddings, functions, meetings and catering: tell us the quantity and date, and we will plan the delivery.',
      points: ['Small bottles in event packs', 'Large quantities on request', 'Quote before you confirm'],
      image: { src: '/images/water-plant/bottling-line.webp', alt: 'Bottles moving along a filling line', width: 458, height: 290 },
      cta: { label: 'Request a bulk quote', link: '/contact', type: 'bulk_order' },
    },
    {
      id: 'ro-supply',
      title: 'RO purified water supply',
      text: 'Our water is treated at an RO purification plant before filling. We supply homes, offices and commercial customers on a regular basis.',
      points: ['Regular supply for homes and offices', 'Commercial and bulk supply enquiries', 'Monthly supply planned with you'],
      image: { src: '/images/water-plant/ro-plant-steel.webp', alt: 'Reverse osmosis water purification equipment', width: 600, height: 600 },
      cta: { label: 'Set up monthly supply', link: '/contact', type: 'monthly_supply' },
    },
  ];
}
