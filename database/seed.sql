-- =====================================================================
-- AquaPure Water — sample data
-- Run once after migrations 0001–0009. Everything here is SAMPLE content:
-- prices are flagged is_sample_price = true (shown with a "Sample price" badge)
-- and testimonials are flagged is_sample = true (shown as "Sample review").
-- Change them from the admin dashboard; the badges disappear when you save
-- a product with "sample price" unticked.
-- =====================================================================

insert into app.business_settings (id) values (1) on conflict (id) do nothing;

insert into app.product_categories (slug, name, description, sort_order) values
  ('water-cans',    '20-Litre Water Cans',             'Returnable 20-litre cans for homes and offices, delivered to your door.', 1),
  ('water-bottles', 'Packaged Drinking Water Bottles', 'Sealed bottles in small, medium and large sizes, sold by the case.',       2)
on conflict (slug) do nothing;

insert into app.products (category_id, slug, name, short_description, description, unit_label, price,
                          is_returnable_can, deposit_amount, track_stock, stock_qty, min_order_qty, max_order_qty,
                          image_path, sort_order)
select c.id, v.slug, v.name, v.short_description, v.description, v.unit_label, v.price,
       v.is_returnable_can, v.deposit_amount, v.track_stock, v.stock_qty, v.min_qty, v.max_qty, v.image_path, v.sort_order
from (values
  ('water-cans', '20-litre-water-can', '20 L Water Can',
   'RO purified drinking water in a returnable 20-litre can.',
   'Our standard 20-litre can for homes and offices. Hand over your empty can when we deliver a full one. If you are new to AquaPure, a refundable can deposit may apply to your first cans.',
   '20 L can', 40.00, true, 150.00, true, 200, 1, 30, null, 1),
  ('water-cans', '20-litre-water-can-office-pack', '20 L Water Can – Office Pack of 5',
   'Five 20-litre cans in one delivery for offices and shops.',
   'Five returnable 20-litre cans delivered together. Suits offices, shops and clinics with a water dispenser.',
   'Pack of 5 × 20 L cans', 190.00, true, 150.00, true, 40, 1, 10, null, 2),
  ('water-bottles', 'bottle-500ml-case-24', '500 ml Bottles – Case of 24',
   'Small sealed bottles, ideal for meetings, travel and events.',
   'A case of 24 sealed 500 ml packaged drinking water bottles.',
   'Case of 24 × 500 ml', 180.00, false, 0, true, 100, 1, 50, null, 3),
  ('water-bottles', 'bottle-1l-case-12', '1 L Bottles – Case of 12',
   'Medium bottles for everyday use at home or work.',
   'A case of 12 sealed 1-litre packaged drinking water bottles.',
   'Case of 12 × 1 L', 160.00, false, 0, true, 100, 1, 50, null, 4),
  ('water-bottles', 'bottle-2l-case-9', '2 L Bottles – Case of 9',
   'Large bottles for families, shops and functions.',
   'A case of 9 sealed 2-litre packaged drinking water bottles.',
   'Case of 9 × 2 L', 170.00, false, 0, true, 60, 1, 50, null, 5),
  ('water-bottles', 'event-pack-250ml-48', 'Event Pack – 250 ml × 48',
   'Small bottles for functions, events and catering.',
   'Forty-eight 250 ml bottles for functions and events. For larger quantities, send us a bulk-order enquiry.',
   'Pack of 48 × 250 ml', 260.00, false, 0, true, 40, 1, 20, null, 6)
) as v(category, slug, name, short_description, description, unit_label, price,
       is_returnable_can, deposit_amount, track_stock, stock_qty, min_qty, max_qty, image_path, sort_order)
join app.product_categories c on c.slug = v.category
on conflict (slug) do nothing;

-- SAMPLE delivery zones: replace the pincodes with the areas you actually serve.
insert into app.delivery_zones (name, pincodes, delivery_charge, free_delivery_min, min_order_amount) values
  ('Zone A – Nearby (sample)', array['600001','600002','600003','600004','600005'], 0.00,  null,   40.00),
  ('Zone B – Extended (sample)', array['600010','600011','600012','600017','600018'], 30.00, 300.00, 80.00);

insert into app.delivery_slots (label, start_time, end_time, capacity, cutoff_minutes, days_of_week, sort_order) values
  ('Morning',   '07:00', '10:00', 25, 120, '{1,2,3,4,5,6,7}', 1),
  ('Midday',    '11:00', '14:00', 25, 120, '{1,2,3,4,5,6}',   2),
  ('Evening',   '16:00', '19:00', 25, 120, '{1,2,3,4,5,6}',   3);

insert into app.testimonials (author_name, author_location, content, rating, is_sample, sort_order) values
  ('Sample Customer', 'Home customer',
   'Placeholder review. Replace this with a genuine review from one of your customers from the admin dashboard.', 5, true, 1),
  ('Sample Office Manager', 'Office customer',
   'Placeholder review describing regular office water deliveries. Replace or remove it before going live.', 5, true, 2),
  ('Sample Event Organiser', 'Event order',
   'Placeholder review for a bulk bottle order for a function. Replace or remove it before going live.', 4, true, 3);
