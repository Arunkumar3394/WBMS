/**
 * AquaPure Water business details shown across the site.
 * Fill these in before going live. Anything left empty is hidden (no placeholder
 * numbers are shown, so customers never call or message a wrong number).
 */
export const BUSINESS = {
  name: 'AquaPure Water',
  tagline: 'Purified drinking water, delivered.',

  /** Phone shown on the site, e.g. '+91 98xxx xxxxx'. Empty = hidden. */
  phone: '',
  /** WhatsApp number with country code, digits only, e.g. '9198xxxxxxxx'. Empty = no WhatsApp buttons. */
  whatsapp: '',
  /** Email for enquiries. Empty = hidden. */
  email: '',
  /** Postal address lines. Empty = hidden. */
  address: [] as string[],
  /** Opening / delivery hours. */
  hours: ['Monday to Saturday: 7:00 AM – 7:00 PM', 'Sunday: morning deliveries only'],
  /** Areas you serve, shown on the Delivery page (the pincodes that can order are set in Admin → Delivery zones). */
  serviceAreas: [] as string[],
} as const;

export function telLink(phone: string): string {
  return 'tel:' + phone.replace(/[^\d+]/g, '');
}

export function whatsappLink(message = 'Hello AquaPure Water, I would like to know more about water delivery.'): string | null {
  return BUSINESS.whatsapp ? `https://wa.me/${BUSINESS.whatsapp}?text=${encodeURIComponent(message)}` : null;
}
