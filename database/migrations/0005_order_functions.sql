-- =====================================================================
-- AquaPure Water — 0005: pricing, delivery slots, orders, enquiries
--
-- Error codes the API understands:
--   P0001  business rule broken  → HTTP 400 with this message shown to the user
--   P0002  not found             → HTTP 404
--   42501  not allowed           → HTTP 403
--
-- price_order and admin_set_order_status are replaced in 0010_cans_per_unit.sql
-- (deposits and can counts in cans rather than product units).
-- =====================================================================

-- ---------- Delivery slots for a date ----------
create or replace function app.available_slots(p_date date)
returns table (slot_id int, label text, start_time time, end_time time,
               remaining int, is_available boolean, reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_settings app.business_settings;
  v_now      timestamp := app.local_now();
  v_today    date := (app.local_now())::date;
  v_date_reason text;
begin
  select * into v_settings from app.business_settings where id = 1;

  v_date_reason := case
    when p_date is null then 'Choose a date'
    when p_date < v_today then 'Date has passed'
    when p_date > v_today + v_settings.max_advance_days then 'Too far ahead'
    when p_date = any (v_settings.closed_dates) then 'Closed on this day'
  end;

  return query
  select s.id, s.label, s.start_time, s.end_time,
         greatest(s.capacity - coalesce(b.booked, 0), 0)::int,
         r.reason is null,
         r.reason
  from app.delivery_slots s
  left join lateral (
    select count(*)::int as booked from app.orders o
    where o.delivery_date = p_date and o.slot_id = s.id and o.status <> 'cancelled'
  ) b on true
  cross join lateral (
    select coalesce(v_date_reason, case
      when not (extract(isodow from p_date)::smallint = any (s.days_of_week)) then 'Not available on this day'
      when p_date + s.start_time - make_interval(mins => s.cutoff_minutes) <= v_now then 'Booking closed'
      when coalesce(b.booked, 0) >= s.capacity then 'Full'
    end) as reason
  ) r
  where s.is_active
  order by s.sort_order, s.start_time;
end $$;

-- ---------- Pricing (internal) ----------
-- Every amount comes from the database; nothing the browser sends is trusted
-- except product ids and quantities, which are validated here.
-- p_items: [{"product_id": 1, "quantity": 2}, ...]
create or replace function app.price_order(p_user_id uuid, p_address_id uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_addr      app.addresses;
  v_zone      app.delivery_zones;
  v_settings  app.business_settings;
  v_lines     jsonb := '[]'::jsonb;
  v_subtotal  numeric(10,2) := 0;
  v_deposit   numeric(10,2) := 0;
  v_delivery  numeric(10,2);
  v_covered   int := 0;
  v_count     int;
  v_distinct  int;
  r           record;
  v_dep_qty   int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'Too many different products in one order (maximum 20).' using errcode = 'P0001';
  end if;

  select count(*), count(distinct (e ->> 'product_id'))
    into v_count, v_distinct
  from jsonb_array_elements(p_items) e;
  if v_count <> v_distinct then
    raise exception 'The same product appears twice in the cart.' using errcode = 'P0001';
  end if;

  select * into v_addr from app.addresses where id = p_address_id and user_id = p_user_id;
  if not found then
    raise exception 'Please choose one of your saved delivery addresses.' using errcode = 'P0001';
  end if;

  select * into v_zone from app.delivery_zones
  where is_active and v_addr.pincode = any (pincodes)
  order by id limit 1;
  if not found then
    raise exception 'Sorry, we do not deliver to pincode % yet. Please contact us.', v_addr.pincode using errcode = 'P0001';
  end if;

  select * into v_settings from app.business_settings where id = 1;

  -- Cans the customer already holds with a deposit, plus cans with a deposit on open orders.
  if v_settings.deposit_enabled then
    select coalesce(sum(cans_delta), 0) into v_covered from app.can_deposit_ledger where user_id = p_user_id;
    v_covered := v_covered + coalesce((
      select sum(oi.deposit_qty) from app.order_items oi join app.orders o on o.id = oi.order_id
      where o.user_id = p_user_id and o.status in ('pending', 'confirmed', 'out_for_delivery')), 0);
  end if;

  for r in
    select p.*, (e ->> 'quantity')::int as qty
    from jsonb_array_elements(p_items) e
    left join app.products p on p.id = (e ->> 'product_id')::int and p.is_active
    order by p.id
  loop
    if r.id is null then
      raise exception 'A product in your cart is no longer available. Please refresh your cart.' using errcode = 'P0001';
    end if;
    if r.qty is null or r.qty < r.min_order_qty or r.qty > r.max_order_qty then
      raise exception 'Quantity for % must be between % and %.', r.name, r.min_order_qty, r.max_order_qty using errcode = 'P0001';
    end if;

    v_dep_qty := 0;
    if v_settings.deposit_enabled and r.is_returnable_can and r.deposit_amount > 0 then
      v_dep_qty := greatest(r.qty - v_covered, 0);
      v_covered := greatest(v_covered - r.qty, 0);
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', r.id, 'product_name', r.name, 'unit_label', r.unit_label,
      'unit_price', r.price, 'quantity', r.qty, 'line_total', r.price * r.qty,
      'track_stock', r.track_stock, 'stock_qty', r.stock_qty,
      'deposit_per_unit', case when v_dep_qty > 0 then r.deposit_amount else 0 end,
      'deposit_qty', v_dep_qty, 'deposit_total', v_dep_qty * r.deposit_amount);
    v_subtotal := v_subtotal + r.price * r.qty;
    v_deposit  := v_deposit + v_dep_qty * r.deposit_amount;
  end loop;

  v_delivery := case when v_zone.free_delivery_min is not null and v_subtotal >= v_zone.free_delivery_min
                     then 0 else v_zone.delivery_charge end;

  return jsonb_build_object(
    'address', jsonb_build_object(
        'label', v_addr.label, 'contact_name', v_addr.contact_name, 'contact_phone', v_addr.contact_phone,
        'line1', v_addr.line1, 'line2', v_addr.line2, 'landmark', v_addr.landmark,
        'city', v_addr.city, 'pincode', v_addr.pincode),
    'zone_id', v_zone.id, 'zone_name', v_zone.name,
    'min_order_amount', v_zone.min_order_amount,
    'free_delivery_min', v_zone.free_delivery_min,
    'lines', v_lines,
    'subtotal', v_subtotal, 'delivery_charge', v_delivery, 'deposit_total', v_deposit,
    'total', v_subtotal + v_delivery + v_deposit);
end $$;

-- Totals for the checkout page (same calculation as place_order).
create or replace function app.quote_order(p_address_id uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  return app.price_order(v_uid, p_address_id, p_items) - 'address';
end $$;

-- ---------- Place an order ----------
create or replace function app.place_order(
  p_address_id      uuid,
  p_items           jsonb,
  p_delivery_date   date,
  p_slot_id         int,
  p_payment_method  app.payment_method,
  p_notes           text,
  p_idempotency_key uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_order_id  uuid;
  v_settings  app.business_settings;
  v_slot      record;
  v_price     jsonb;
  v_line      jsonb;
  v_stock     int;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'Missing request key.' using errcode = 'P0001'; end if;

  -- Same request sent twice (double-click, network retry): return the first order.
  select id into v_order_id from app.orders where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return v_order_id; end if;

  if not exists (select 1 from app.profiles where id = v_uid and is_active) then
    raise exception 'Your account is not active. Please contact us.' using errcode = '42501';
  end if;

  select * into v_settings from app.business_settings where id = 1;
  if p_payment_method = 'cod' and not v_settings.cod_enabled then
    raise exception 'Cash on delivery is not available right now.' using errcode = 'P0001';
  end if;
  if p_payment_method = 'razorpay' and not v_settings.online_payment_enabled then
    raise exception 'Online payment is not available right now.' using errcode = 'P0001';
  end if;

  -- Lock the slot so two customers cannot both take its last place.
  perform 1 from app.delivery_slots where id = p_slot_id for update;
  select * into v_slot from app.available_slots(p_delivery_date) s where s.slot_id = p_slot_id;
  if not found then
    raise exception 'Please choose a delivery slot.' using errcode = 'P0001';
  end if;
  if not v_slot.is_available then
    raise exception 'The % slot on % is not available (%). Please choose another.',
      v_slot.label, to_char(p_delivery_date, 'DD Mon'), lower(v_slot.reason) using errcode = 'P0001';
  end if;

  -- Lock the products (in id order, to avoid deadlocks) before checking stock.
  perform 1 from app.products
  where id in (select (e ->> 'product_id')::int from jsonb_array_elements(p_items) e)
  order by id for update;

  v_price := app.price_order(v_uid, p_address_id, p_items);

  if (v_price ->> 'subtotal')::numeric < (v_price ->> 'min_order_amount')::numeric then
    raise exception 'The minimum order for your area is ₹%.', v_price ->> 'min_order_amount' using errcode = 'P0001';
  end if;

  begin
    insert into app.orders (user_id, address_id, delivery_address, zone_id, delivery_date, slot_id, slot_label,
                            payment_method, payment_status, subtotal, delivery_charge, deposit_total, total,
                            customer_notes, idempotency_key)
    values (v_uid, p_address_id, v_price -> 'address', (v_price ->> 'zone_id')::int, p_delivery_date, p_slot_id,
            v_slot.label || ' (' || to_char(v_slot.start_time, 'HH12:MI AM') || ' – ' || to_char(v_slot.end_time, 'HH12:MI AM') || ')',
            p_payment_method,
            case when p_payment_method = 'cod' then 'unpaid'::app.payment_status else 'pending'::app.payment_status end,
            (v_price ->> 'subtotal')::numeric, (v_price ->> 'delivery_charge')::numeric,
            (v_price ->> 'deposit_total')::numeric, (v_price ->> 'total')::numeric,
            nullif(left(trim(p_notes), 500), ''), p_idempotency_key)
    returning id into v_order_id;
  exception when unique_violation then
    -- A parallel request with the same key won the race.
    select id into v_order_id from app.orders where user_id = v_uid and idempotency_key = p_idempotency_key;
    if v_order_id is null then raise; end if;
    return v_order_id;
  end;

  for v_line in select * from jsonb_array_elements(v_price -> 'lines') loop
    insert into app.order_items (order_id, product_id, product_name, unit_label, unit_price, quantity, line_total,
                                 deposit_per_unit, deposit_qty, deposit_total)
    values (v_order_id, (v_line ->> 'product_id')::int, v_line ->> 'product_name', v_line ->> 'unit_label',
            (v_line ->> 'unit_price')::numeric, (v_line ->> 'quantity')::int, (v_line ->> 'line_total')::numeric,
            (v_line ->> 'deposit_per_unit')::numeric, (v_line ->> 'deposit_qty')::int, (v_line ->> 'deposit_total')::numeric);

    if (v_line ->> 'track_stock')::boolean then
      update app.products set stock_qty = stock_qty - (v_line ->> 'quantity')::int
      where id = (v_line ->> 'product_id')::int and stock_qty >= (v_line ->> 'quantity')::int
      returning stock_qty into v_stock;
      if not found then
        raise exception 'Sorry, only % left of %.', v_line ->> 'stock_qty', v_line ->> 'product_name' using errcode = 'P0001';
      end if;
      insert into app.inventory_transactions (product_id, qty_delta, reason, order_id, created_by)
      values ((v_line ->> 'product_id')::int, -(v_line ->> 'quantity')::int, 'order_reserved', v_order_id, v_uid);
    end if;
  end loop;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (v_order_id, null, 'pending', 'Order placed', v_uid);

  return v_order_id;
end $$;

-- ---------- Cancelling (internal; puts stock back) ----------
create or replace function app.cancel_order_internal(p_order_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order app.orders;
  r record;
begin
  select * into v_order from app.orders where id = p_order_id for update;
  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'This order is already %.', v_order.status using errcode = 'P0001';
  end if;

  update app.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(left(trim(p_reason), 300), ''),
      needs_refund = needs_refund or payment_status = 'paid'
  where id = p_order_id;

  for r in
    select oi.product_id, oi.quantity from app.order_items oi
    join app.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.track_stock
    order by oi.product_id
  loop
    update app.products set stock_qty = stock_qty + r.quantity where id = r.product_id;
    insert into app.inventory_transactions (product_id, qty_delta, reason, order_id, created_by)
    values (r.product_id, r.quantity, 'order_released', p_order_id, p_actor);
  end loop;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, 'cancelled', coalesce(nullif(left(trim(p_reason), 300), ''), 'Cancelled'), p_actor);
end $$;

-- Customers may cancel their own order while it is still pending and not paid.
create or replace function app.cancel_my_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order app.orders;
begin
  if auth.uid() is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  select * into v_order from app.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.status <> 'pending' then
    raise exception 'This order is already % and can no longer be cancelled online. Please call us.',
      replace(v_order.status::text, '_', ' ') using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'This order is already paid. Please contact us to cancel it and arrange a refund.' using errcode = 'P0001';
  end if;
  perform app.cancel_order_internal(p_order_id, auth.uid(), coalesce(nullif(trim(p_reason), ''), 'Cancelled by customer'));
end $$;

-- ---------- Staff: move an order along ----------
-- pending → confirmed | cancelled
-- confirmed → out_for_delivery | cancelled
-- out_for_delivery → delivered | confirmed (delivery attempt failed) | cancelled
create or replace function app.admin_set_order_status(
  p_order_id uuid, p_status app.order_status, p_note text default null,
  p_cans_delivered int default null, p_empties_collected int default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order app.orders;
  v_dep_qty int;
begin
  perform app.require_staff();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;

  if not ((v_order.status = 'pending'          and p_status in ('confirmed', 'cancelled'))
       or (v_order.status = 'confirmed'        and p_status in ('out_for_delivery', 'cancelled'))
       or (v_order.status = 'out_for_delivery' and p_status in ('delivered', 'confirmed', 'cancelled'))) then
    raise exception 'An order that is % cannot be changed to %.',
      replace(v_order.status::text, '_', ' '), replace(p_status::text, '_', ' ') using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' then
    perform app.cancel_order_internal(p_order_id, auth.uid(), coalesce(p_note, 'Cancelled by AquaPure'));
    return;
  end if;

  if p_status = 'confirmed' and v_order.status = 'pending'
     and v_order.payment_method = 'razorpay' and v_order.payment_status <> 'paid' then
    raise exception 'Online payment has not been received for this order yet.' using errcode = 'P0001';
  end if;

  if p_status = 'delivered' then
    if p_cans_delivered < 0 or p_empties_collected < 0 then
      raise exception 'Can counts cannot be negative.' using errcode = 'P0001';
    end if;
    update app.orders
    set delivered_at = now(),
        cans_delivered = coalesce(p_cans_delivered, (
          select coalesce(sum(oi.quantity), 0) from app.order_items oi join app.products p on p.id = oi.product_id
          where oi.order_id = p_order_id and p.is_returnable_can)),
        empties_collected = p_empties_collected
    where id = p_order_id;

    select coalesce(sum(deposit_qty), 0) into v_dep_qty from app.order_items where order_id = p_order_id;
    if v_dep_qty > 0 then
      insert into app.can_deposit_ledger (user_id, order_id, entry_type, cans_delta, amount, note, created_by)
      values (v_order.user_id, p_order_id, 'collected', v_dep_qty, v_order.deposit_total,
              'Deposit with order ' || v_order.order_no, auth.uid());
    end if;
  end if;

  update app.orders
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' and confirmed_at is null then now() else confirmed_at end
  where id = p_order_id;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, p_status, nullif(left(trim(p_note), 500), ''), auth.uid());
end $$;

-- Staff: cash collected for a cash-on-delivery order.
create or replace function app.admin_mark_cod_paid(p_order_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order app.orders;
begin
  perform app.require_staff();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_method <> 'cod' or v_order.payment_status <> 'unpaid' or v_order.status = 'cancelled' then
    raise exception 'Only unpaid cash-on-delivery orders can be marked as paid.' using errcode = 'P0001';
  end if;
  insert into app.payments (order_id, provider, amount_paise, status, recorded_by, captured_at)
  values (p_order_id, 'cash', (v_order.total * 100)::bigint, 'captured', auth.uid(), now());
  update app.orders set payment_status = 'paid' where id = p_order_id;
end $$;

-- Admin: a refund was made in the Razorpay dashboard (or in cash).
create or replace function app.admin_mark_refunded(p_order_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order app.orders;
begin
  perform app.require_admin();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can be marked as refunded.' using errcode = 'P0001';
  end if;
  update app.orders
  set payment_status = 'refunded', needs_refund = false,
      admin_notes = left(concat_ws(E'\n', admin_notes, 'Refunded: ' || coalesce(nullif(trim(p_note), ''), 'no note')), 1000)
  where id = p_order_id;
  update app.payments set status = 'refunded' where order_id = p_order_id and status = 'captured';
end $$;

create or replace function app.admin_set_order_notes(p_order_id uuid, p_notes text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_staff();
  update app.orders set admin_notes = nullif(left(trim(p_notes), 1000), '') where id = p_order_id;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
end $$;

-- ---------- Admin: stock, deposits, roles ----------
create or replace function app.admin_adjust_stock(p_product_id int, p_delta int, p_reason app.inventory_reason, p_note text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_new int;
begin
  perform app.require_admin();
  if p_reason not in ('restock', 'adjustment', 'damaged') then
    raise exception 'Reason must be restock, adjustment or damaged.' using errcode = 'P0001';
  end if;
  if p_delta = 0 then raise exception 'Change cannot be zero.' using errcode = 'P0001'; end if;
  update app.products set stock_qty = stock_qty + p_delta
  where id = p_product_id and stock_qty + p_delta >= 0
  returning stock_qty into v_new;
  if not found then
    raise exception 'Product not found, or stock would go below zero.' using errcode = 'P0001';
  end if;
  insert into app.inventory_transactions (product_id, qty_delta, reason, note, created_by)
  values (p_product_id, p_delta, p_reason, nullif(left(trim(p_note), 300), ''), auth.uid());
  return v_new;
end $$;

-- Cans returned and deposit paid back (or a manual correction).
create or replace function app.admin_record_deposit(p_user_id uuid, p_entry app.deposit_entry, p_cans int, p_amount numeric, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_held int;
begin
  perform app.require_admin();
  if p_entry = 'collected' then
    raise exception 'Deposits are collected through orders. Use refunded or adjustment here.' using errcode = 'P0001';
  end if;
  select coalesce(sum(cans_delta), 0) into v_held from app.can_deposit_ledger where user_id = p_user_id;
  if p_entry = 'refunded' then
    if p_cans <= 0 or p_amount < 0 then
      raise exception 'Enter the number of cans returned and the amount refunded.' using errcode = 'P0001';
    end if;
    if p_cans > v_held then
      raise exception 'This customer holds only % can(s) with a deposit.', v_held using errcode = 'P0001';
    end if;
    insert into app.can_deposit_ledger (user_id, entry_type, cans_delta, amount, note, created_by)
    values (p_user_id, 'refunded', -p_cans, -p_amount, nullif(left(trim(p_note), 300), ''), auth.uid());
  else
    if v_held + p_cans < 0 then
      raise exception 'Can balance cannot go below zero.' using errcode = 'P0001';
    end if;
    insert into app.can_deposit_ledger (user_id, entry_type, cans_delta, amount, note, created_by)
    values (p_user_id, 'adjustment', p_cans, p_amount, nullif(left(trim(p_note), 300), ''), auth.uid());
  end if;
end $$;

create or replace function app.admin_set_user_role(p_user_id uuid, p_role app.user_role, p_is_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_admin();
  -- Serialise role changes so two admins cannot demote each other at the same moment.
  perform 1 from app.profiles where role = 'admin' for update;
  update app.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from app.profiles where role = 'admin' and is_active) then
    raise exception 'There must be at least one active admin.' using errcode = 'P0001';
  end if;
end $$;

-- ---------- Enquiries (contact, bulk order, monthly supply) ----------
create or replace function app.submit_enquiry(
  p_type app.enquiry_type, p_name text, p_phone text, p_email text, p_company text,
  p_quantity_note text, p_preferred_date date, p_message text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_preferred_date is not null and (p_preferred_date < current_date or p_preferred_date > current_date + 365) then
    raise exception 'Please choose a date within the next year.' using errcode = 'P0001';
  end if;
  insert into app.enquiries (enquiry_type, name, phone, email, company, quantity_note, preferred_date, message, user_id)
  values (coalesce(p_type, 'general'), trim(p_name), regexp_replace(p_phone, '[\s-]', '', 'g'),
          nullif(trim(p_email), ''), nullif(trim(p_company), ''), nullif(trim(p_quantity_note), ''),
          p_preferred_date, trim(p_message), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Who may call what ----------
grant execute on function app.available_slots(date)                      to anon, authenticated;
grant execute on function app.submit_enquiry(app.enquiry_type, text, text, text, text, text, date, text) to anon, authenticated;
grant execute on function app.quote_order(uuid, jsonb)                   to authenticated;
grant execute on function app.place_order(uuid, jsonb, date, int, app.payment_method, text, uuid) to authenticated;
grant execute on function app.cancel_my_order(uuid, text)                to authenticated;
grant execute on function app.admin_set_order_status(uuid, app.order_status, text, int, int) to authenticated;
grant execute on function app.admin_mark_cod_paid(uuid)                  to authenticated;
grant execute on function app.admin_mark_refunded(uuid, text)            to authenticated;
grant execute on function app.admin_set_order_notes(uuid, text)          to authenticated;
grant execute on function app.admin_adjust_stock(int, int, app.inventory_reason, text) to authenticated;
grant execute on function app.admin_record_deposit(uuid, app.deposit_entry, int, numeric, text) to authenticated;
grant execute on function app.admin_set_user_role(uuid, app.user_role, boolean) to authenticated;
-- price_order and cancel_order_internal are internal: no grants.
-- expire_unpaid_orders is defined in 0006.

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;
