-- =====================================================================
-- AquaPure Water — 0008: reports for the admin dashboard
-- "Sales" counts orders that were not cancelled. "Collected" counts money
-- actually received (orders whose payment status is paid).
-- Deposits are shown separately: they are refundable, not revenue.
-- =====================================================================

create or replace function app.admin_sales_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_tz text := coalesce((select timezone from app.business_settings where id = 1), 'Asia/Kolkata');
begin
  perform app.require_staff();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a date range of up to one year.' using errcode = 'P0001';
  end if;

  with o as (
    select * from app.orders
    where (created_at at time zone v_tz)::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select jsonb_build_object(
        'orders',          count(*),
        'delivered',       count(*) filter (where status = 'delivered'),
        'cancelled',       count(*) filter (where status = 'cancelled'),
        'open',            count(*) filter (where status in ('pending', 'confirmed', 'out_for_delivery')),
        'sales',           coalesce(sum(subtotal + delivery_charge) filter (where status <> 'cancelled'), 0),
        'collected',       coalesce(sum(subtotal + delivery_charge) filter (where payment_status = 'paid'), 0),
        'deposits',        coalesce(sum(deposit_total) filter (where status <> 'cancelled'), 0),
        'cod_outstanding', coalesce(sum(total) filter (where payment_method = 'cod' and payment_status = 'unpaid' and status <> 'cancelled'), 0),
        'needs_refund',    count(*) filter (where needs_refund))
      from o),
    'by_day', coalesce((select jsonb_agg(d order by d ->> 'day') from (
        select jsonb_build_object(
          'day', (created_at at time zone v_tz)::date,
          'orders', count(*),
          'sales', coalesce(sum(subtotal + delivery_charge) filter (where status <> 'cancelled'), 0)) d
        from o group by (created_at at time zone v_tz)::date) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(p order by (p ->> 'sales')::numeric desc) from (
        select jsonb_build_object(
          'product_id', oi.product_id, 'name', max(oi.product_name),
          'quantity', sum(oi.quantity), 'sales', sum(oi.line_total)) p
        from app.order_items oi join o on o.id = oi.order_id
        where o.status <> 'cancelled'
        group by oi.product_id) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from o group by status) x), '{}'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- Numbers for the admin home page.
create or replace function app.admin_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (app.local_now())::date;
  v_tz text := coalesce((select timezone from app.business_settings where id = 1), 'Asia/Kolkata');
begin
  perform app.require_staff();
  return jsonb_build_object(
    'pending_orders',      (select count(*) from app.orders where status = 'pending'),
    'today_deliveries',    (select count(*) from app.orders where delivery_date = v_today and status in ('confirmed', 'out_for_delivery')),
    'out_for_delivery',    (select count(*) from app.orders where status = 'out_for_delivery'),
    'needs_refund',        (select count(*) from app.orders where needs_refund),
    'new_enquiries',       (select count(*) from app.enquiries where status = 'new'),
    'low_stock',           (select count(*) from app.products where is_active and track_stock and stock_qty < 10),
    'today_sales',         (select coalesce(sum(subtotal + delivery_charge), 0) from app.orders
                            where (created_at at time zone v_tz)::date = v_today and status <> 'cancelled'));
end $$;

grant execute on function app.admin_sales_summary(date, date) to authenticated;
grant execute on function app.admin_dashboard()               to authenticated;

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;
