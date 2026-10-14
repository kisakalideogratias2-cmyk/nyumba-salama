NYUMBA SALAMA — MEDIA UPLOADS (PHOTOS + VIDEOS)

WHAT THIS UPGRADE ADDS
- Upload up to 8 property photos (JPG, PNG, WEBP, AVIF), max 10 MB each.
- Upload up to 2 property videos (MP4, WEBM, MOV), max 50 MB each.
- Preview selected files before posting.
- Upload media to Supabase Storage bucket `property-media`.
- Save media URLs with each property record.
- Show the first photo/video and all attached videos on listing cards.
- Keep existing demo listings and the rest of the Phase 2 prototype.

INSTALL
1. Back up your current project first.
2. Open Supabase Dashboard > SQL Editor.
3. Run database/media_uploads.sql AFTER database/phase2.sql.
4. Replace frontend/cloud.js with the cloud.js in this package.
5. Replace frontend/app.js with the app.js in this package ONLY if your current project uses the Phase 2 app.js included here. If you have a different custom app.js with extra features, do not overwrite it; merge the media rendering changes instead.
6. Append the contents of frontend/style.css to your existing stylesheet (or replace style.css only if you are using this exact Phase 2 project).
7. Ensure frontend/index.html loads config.js, Supabase JS v2, app.js, then cloud.js as in the included file.
8. Reload the app, sign in, tap “Ongeza nyumba”, choose photos/videos, then publish.

IMPORTANT
- Use the Supabase publishable/anon key in frontend/config.js only. Never put a service_role key in browser code.
- Uploaded media is publicly viewable because the bucket is public. Do not upload IDs, contracts, phone screenshots, or private material.
- Supabase Storage bandwidth and file storage are subject to your project's quota.
- If upload fails, check that the SQL migration succeeded and that the user is signed in.
