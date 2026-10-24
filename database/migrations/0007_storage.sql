-- =====================================================================
-- AquaPure Water — 0007: product image storage
-- Public bucket: anyone can view images by URL. Only admins can upload,
-- replace or delete (checked against app.profiles, not the browser).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and app.is_admin());

create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and app.is_admin())
  with check (bucket_id = 'product-images' and app.is_admin());

create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and app.is_admin());

-- Lets the admin page list existing images to pick from.
create policy product_images_admin_list on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and app.is_admin());
