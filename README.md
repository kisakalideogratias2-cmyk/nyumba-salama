# NYUMBA SALAMA — PHASE 2

## What works
- Modern Phase 1 UI (all offline demo modules retained)
- Supabase email sign-up/sign-in/sign-out
- Public online property listings
- Logged-in owner can publish and delete their own properties
- Owner dashboard and RLS policies to prevent editing other users’ listings

## Android setup (Spck Editor or any HTML/CSS/JS editor)
1. Extract ZIP and open `frontend/index.html` to see the demo.
2. Create a Supabase project at https://supabase.com (free tier subject to limits).
3. In Supabase **SQL Editor**, run `database/phase2.sql` **on a fresh project**. Do not run old `database/schema.sql` as well: that older schema uses incompatible profile IDs.
4. In **Project Settings > API**, copy **Project URL** and **anon/publishable key** into `frontend/config.js`. Never paste `service_role`/secret key.
5. In **Authentication > URL Configuration**, add your actual hosted site URL and any callback URL you use. Confirm-email signup may require email verification.
6. For reliable sign-in/email redirects, serve the frontend via an HTTPS static host. Opening index.html with `file://` may work for browsing but can break auth redirects and some browsers' security policies.
7. Reload, tap **Ingia / Jisajili**, create account, verify email if prompted, then add property.

## Security and honesty
- Online listings are **unverified**; users must independently verify owners/properties.
- Phase 1 demo listings are labelled DEMO and stored locally.
- LUKU, maintenance, roommates, reviews, contracts, saved homes are **still local-only**, not shared online.
- No real SMS OTP, legally binding e-signatures, payment gateway, or property photo upload yet.
- Never mark property ownership as verified from a browser input.
- For production add moderation, spam limits, contact safety, privacy policy, image storage rules and abuse reporting.

## Troubleshooting
- `Invalid API key`: check config.js and project URL.
- `relation does not exist`: run phase2.sql in SQL Editor.
- `new row violates row-level security`: sign in and verify the SQL ran successfully.
- `Email not confirmed`: click the link Supabase sent.
- `Supabase not loaded`: use internet and check CDN access.
