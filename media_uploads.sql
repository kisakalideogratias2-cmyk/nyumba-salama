-- NYUMBA SALAMA: property photos and videos
-- Run this AFTER database/phase2.sql in Supabase SQL Editor.

alter table public.properties
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists video_urls text[] not null default '{}';

-- Public bucket means uploaded listing media can be displayed to prospective tenants.
-- Images: max 10 MB each; videos: max 50 MB each (validated in the browser too).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-media',
  'property-media',
  true,
  52428800,
  array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can view media attached to published listings (public bucket).
drop policy if exists "Public can view property media" on storage.objects;
create policy "Public can view property media"
on storage.objects for select
using (bucket_id = 'property-media');

-- Signed-in users can upload only into their own folder: <auth.uid()>/filename.
drop policy if exists "Owners upload their own property media" on storage.objects;
create policy "Owners upload their own property media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'property-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Owners can remove only files from their own folder.
drop policy if exists "Owners delete their own property media" on storage.objects;
create policy "Owners delete their own property media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'property-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
