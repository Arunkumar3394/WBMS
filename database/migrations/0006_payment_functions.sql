-- =====================================================================
-- AquaPure Water — 0006: Razorpay payments, webhooks, rate limiting
--
-- Only the "wbms_api" role may call these, and only as itself (never while
-- acting as a customer). The API calls them after it has verified the Razorpay
-- signature and, for captures, re-fetched the payment from Razorpay.
-- Every function is safe to call more than once with the same input.
-- =====================================================================

-- Step 1 of checkout: check the order can be paid online and return what the
-- API needs to create (or reuse) a Razorpay order. p_user_id is the signed-in
-- user the API verified from the JWT.
create or replace function app.begin_razorpay_checkout(p_order_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order   app.orders;
  v_profile app.profiles;
  v_rzp     text;
begin
  select * into v_order from app.orders where id = p_order_id and user_id = p_user_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_method <> 'razorpay' then
    raise exception 'This order is not set up for online payment.' using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'This order is already paid.' using errcode = 'P0001';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status not in ('pending', 'failed') then
    raise exception 'This order can no longer be paid online.' using errcode = 'P0001';
  end if;

  -- Reuse the open Razorpay order for the same amount (Razorpay allows several
  -- attempts on one order), so retries never create a second payable order.
  update app.payments set updated_at = now()
  where order_id = p_order_id and provider = 'razorpay' and status = 'created'
    and amount_paise = (v_order.total * 100)::bigint
  returning razorpay_order_id into v_rzp;

  update app.orders set payment_status = 'pending' where id = p_order_id and payment_status = 'failed';

  select * into v_profile from app.profiles where id = p_user_id;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'amount_paise', (v_order.total * 100)::bigint, 'currency', 'INR',
    'razorpay_order_id', v_rzp,
    'customer_name', v_profile.full_name, 'customer_email', v_profile.email,
    'customer_phone', coalesce(v_profile.phone, v_order.delivery_address ->> 'contact_phone'));
end $$;

-- Step 2: remember the Razorpay order the API just created.
create or replace function app.record_razorpay_order(p_order_id uuid, p_razorpay_order_id text, p_amount_paise bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_total bigint;
begin
  select (total * 100)::bigint into v_total from app.orders where id = p_order_id;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_total <> p_amount_paise then
    raise exception 'Amount does not match the order total.' using errcode = 'P0001';
  end if;
  insert into app.payments (order_id, provider, razorpay_order_id, amount_paise, status)
  values (p_order_id, 'razorpay', p_razorpay_order_id, p_amount_paise, 'created')
  on conflict (razorpay_order_id) do nothing;
end $$;

-- A payment was captured (from the checkout callback or the webhook).
-- Returns: applied | already_recorded | unknown_order | amount_mismatch | duplicate | paid_but_cancelled
create or replace function app.mark_payment_captured(
  p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_paise bigint, p_method text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_pay   app.payments;
  v_order app.orders;
  v_note  text;
begin
  select * into v_pay from app.payments where razorpay_order_id = p_razorpay_order_id for update;
  if not found then return 'unknown_order'; end if;            -- not created by this site
  select * into v_order from app.orders where id = v_pay.order_id for update;

  if v_pay.razorpay_payment_id = p_razorpay_payment_id and v_pay.status in ('captured', 'refunded') then
    return 'already_recorded';                                  -- callback + webhook, or a retry
  end if;

  if p_amount_paise <> v_pay.amount_paise or p_amount_paise <> (v_order.total * 100)::bigint then
    update app.payments
    set error_code = 'amount_mismatch',
        error_description = format('Captured %s paise, expected %s', p_amount_paise, v_pay.amount_paise)
    where id = v_pay.id;
    update app.orders set needs_refund = true,
      admin_notes = left(concat_ws(E'\n', admin_notes, format('Payment %s amount did not match the order. Check Razorpay.', p_razorpay_payment_id)), 1000)
    where id = v_order.id;
    return 'amount_mismatch';
  end if;

  if v_pay.status = 'captured' or v_order.payment_status in ('paid', 'refunded') then
    -- The order was already paid through another payment: keep a record and flag a refund.
    v_note := format('Second payment %s received for this order. Refund it from the Razorpay dashboard.', p_razorpay_payment_id);
    if v_pay.status <> 'captured' then
      update app.payments set status = 'captured', razorpay_payment_id = p_razorpay_payment_id,
                              method = p_method, captured_at = now()
      where id = v_pay.id;
    end if;
    update app.orders set needs_refund = true, admin_notes = left(concat_ws(E'\n', admin_notes, v_note), 1000)
    where id = v_order.id;
    return 'duplicate';
  end if;

  update app.payments
  set status = 'captured', razorpay_payment_id = p_razorpay_payment_id, method = p_method,
      captured_at = now(), error_code = null, error_description = null
  where id = v_pay.id;

  update app.orders
  set payment_status = 'paid', needs_refund = (status = 'cancelled')
  where id = v_order.id;

  if v_order.status = 'cancelled' then
    update app.orders set admin_notes = left(concat_ws(E'\n', admin_notes,
      'Payment arrived after the order was cancelled. Refund it, or contact the customer.'), 1000)
    where id = v_order.id;
    return 'paid_but_cancelled';
  end if;
  return 'applied';
end $$;

-- A payment attempt failed. The customer can try again on the same Razorpay order.
create or replace function app.mark_payment_failed(
  p_razorpay_order_id text, p_razorpay_payment_id text, p_error_code text, p_error_description text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_pay app.payments;
begin
  select * into v_pay from app.payments where razorpay_order_id = p_razorpay_order_id for update;
  if not found then return 'unknown_order'; end if;
  if v_pay.status <> 'created' then return 'ignored'; end if;   -- already captured: a late failure event
  update app.payments
  set error_code = left(p_error_code, 100), error_description = left(p_error_description, 500)
  where id = v_pay.id;
  update app.orders set payment_status = 'failed'
  where id = v_pay.order_id and payment_status = 'pending';
  return 'recorded';
end $$;

-- Returns true the first time an event id is seen. The API calls this in the same
-- transaction as the mark_* function, so a failure rolls both back and Razorpay retries.
create or replace function app.record_webhook_event(p_event_id text, p_event_type text, p_payload jsonb)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into app.payment_webhook_events (event_id, event_type, payload)
  values (p_event_id, p_event_type, p_payload)
  on conflict (event_id) do nothing;
  return found;
end $$;

-- Fixed-window rate limit shared by every API server. Returns false when over the limit.
create or replace function app.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into app.rate_limits (key, window_start, hits) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = app.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Unpaid online orders: don't expire one while a payment attempt is recent.
create or replace function app.expire_unpaid_orders()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_minutes int;
  v_id uuid;
  v_count int := 0;
begin
  select unpaid_order_expiry_minutes into v_minutes from app.business_settings where id = 1;
  for v_id in
    select o.id from app.orders o
    where o.status = 'pending' and o.payment_method = 'razorpay' and o.payment_status in ('pending', 'failed')
      and o.created_at < now() - make_interval(mins => v_minutes)
      and not exists (select 1 from app.payments p
                      where p.order_id = o.id and p.updated_at > now() - make_interval(mins => v_minutes))
    order by o.created_at
    for update of o skip locked
  loop
    perform app.cancel_order_internal(v_id, null, 'Online payment was not completed in time.');
    v_count := v_count + 1;
  end loop;
  delete from app.rate_limits where window_start < now() - interval '1 day';
  return v_count;
end $$;

grant execute on function app.begin_razorpay_checkout(uuid, uuid)            to wbms_api;
grant execute on function app.record_razorpay_order(uuid, text, bigint)      to wbms_api;
grant execute on function app.mark_payment_captured(text, text, bigint, text) to wbms_api;
grant execute on function app.mark_payment_failed(text, text, text, text)    to wbms_api;
grant execute on function app.record_webhook_event(text, text, jsonb)        to wbms_api;
grant execute on function app.check_rate_limit(text, int, int)               to wbms_api;
grant execute on function app.expire_unpaid_orders()                         to wbms_api;

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;
