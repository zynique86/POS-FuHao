-- ============================================================================
-- Dim Sum POS — Menu Photos Migration
-- Adds image_url on menu_items and sets up a public Supabase Storage bucket
-- so staff can upload item pictures directly from the admin panel.
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. image_url column
-- ----------------------------------------------------------------------------
alter table menu_items
  add column if not exists image_url text;

-- ----------------------------------------------------------------------------
-- 2. Storage bucket — public read, authenticated write.
--    5 MB per file cap, allowed image types.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-photos',
  'menu-photos',
  true,
  5242880,                       -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 3. Policies on storage.objects for this bucket.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_read_any') then
    create policy menu_photos_read_any on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_insert_auth') then
    create policy menu_photos_insert_auth on storage.objects
      for insert to authenticated
      with check (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_update_auth') then
    create policy menu_photos_update_auth on storage.objects
      for update to authenticated
      using (bucket_id = 'menu-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_photos_delete_auth') then
    create policy menu_photos_delete_auth on storage.objects
      for delete to authenticated
      using (bucket_id = 'menu-photos');
  end if;
end $$;
