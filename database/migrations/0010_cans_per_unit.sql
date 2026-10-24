-- =====================================================================
-- AquaPure Water — 0010: cans per unit
--
-- A product can hold several returnable cans (e.g. an office pack of five 20 L cans).
-- Deposits and the default "cans delivered" count are now worked out in CANS, not in
-- product units. products.deposit_amount is the deposit for ONE can.
-- order_items.deposit_qty / deposit_per_unit are a number of cans / the deposit per can.
--
-- Replaces app.price_order and app.admin_set_order_status from 0005.
-- Already installed AquaPure before this file existed? Run just this file in the SQL Editor.
-- It is safe to run more than once.
-- =====================================================================

alter table app.products
  add column if not exists cans_per_unit int not null default 1 check (cans_per_unit between 1 and 100);

-- order_items.deposit_qty is now a number of cans, so it can be more than the quantity of packs.
-- The old rule (deposit_qty <= quantity) had a generated name, so find it by its definition.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'app.order_items'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%deposit_qty <= quantity%'
  loop
    execute format('alter table app.order_items drop constraint %I', c.conname);
  end loop;
end $$;
alter table app.order_items drop constraint if exists order_items_deposit_qty_check;
alter table app.order_items add constraint order_items_deposit_qty_check check (deposit_qty >= 0);

comment on column app.products.cans_per_unit is 'Returnable cans in one unit of this product (1 for a single can, 5 for a pack of five).';
comment on column app.products.deposit_amount is 'Refundable deposit for one returnable can.';

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
      v_dep_qty := greatest(r.qty * r.cans_per_unit - v_covered, 0);   -- in cans, not packs
      v_covered := greatest(v_covered - r.qty * r.cans_per_unit, 0);
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
          select coalesce(sum(oi.quantity * p.cans_per_unit), 0) from app.order_items oi join app.products p on p.id = oi.product_id
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

-- The sample office pack holds five cans (no-op if you renamed or changed it).
update app.products set cans_per_unit = 5
where slug = '20-litre-water-can-office-pack' and cans_per_unit = 1;

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;
