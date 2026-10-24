import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeader } from '../shared/ui';

// Answers match how the site actually works (slots, payment, deposits, cancellation).
// Keep them in step if you change those rules in Admin → Settings.
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I order?',
    a: 'Choose your products, add them to your cart, and check out. You will need an account so we can save your address and show you your order status.',
  },
  {
    q: 'When will my water arrive?',
    a: 'At checkout you choose a delivery date and a time slot (morning, midday or evening). Each slot closes a little before it starts and can be fully booked; the available slots are shown when you order.',
  },
  {
    q: 'Which areas do you deliver to?',
    a: 'Enter your pincode on the Delivery page to check. The delivery charge, if any, and the minimum order for your area are shown there and at checkout.',
  },
  {
    q: 'How can I pay?',
    a: 'Pay online at checkout (UPI, cards and net banking through Razorpay), or choose cash on delivery where it is available.',
  },
  {
    q: 'Is there a deposit for the 20-litre cans?',
    a: 'Cans are returnable. A refundable deposit may apply when you take more cans than you return, for example on your first order. If it applies, the amount is shown clearly at checkout before you pay. Deposits are refunded when you return the cans.',
  },
  {
    q: 'What happens to my empty cans?',
    a: 'Keep your empty cans ready. Our delivery staff collect them when they bring your full cans.',
  },
  {
    q: 'Can I cancel an order?',
    a: 'You can cancel online while the order is still pending and has not been paid. After it is confirmed or paid, please contact us and we will help, including any refund that is due.',
  },
  {
    q: 'What if my online payment fails?',
    a: 'Your order stays open for a short time so you can try paying again from your order page. If money was taken but the payment did not go through, it is matched automatically or refunded.',
  },
  {
    q: 'Do you supply offices, events and bulk orders?',
    a: 'Yes. Send us an enquiry with the quantity, date and place, and we will reply with a quote. For regular supply, choose "Monthly supply" in the enquiry form.',
  },
];

@Component({
  selector: 'app-faq',
  imports: [RouterLink, PageHeader],
  template: `
    <app-page-header eyebrow="Help" title="Frequently asked questions" />
    <div class="container-page max-w-3xl py-12">
      <div class="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        @for (f of faqs; track f.q) {
          <details class="group p-5">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-brand-900">
              {{ f.q }}
              <span class="text-xl text-brand-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <p class="mt-3 text-slate-600">{{ f.a }}</p>
          </details>
        }
      </div>
      <p class="mt-8 text-slate-600">
        Still have a question? <a routerLink="/contact" class="font-medium text-brand-700 underline">Contact us</a>.
      </p>
    </div>
  `,
})
export class Faq {
  protected readonly faqs = FAQS;
}
