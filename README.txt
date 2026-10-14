NYUMBA SALAMA — Hybrid Premium Admin Dashboard

1. Extract ZIP.
2. Copy admin.html, admin.css and admin.js into the SAME folder as your existing index.html and config.js.
3. Do not overwrite your working index.html, app.js or config.js.
4. Log in using your admin account, then open admin.html.
5. This dashboard expects window.NS_CONFIG.supabaseUrl and window.NS_CONFIG.supabaseAnonKey.
6. Requires RPCs: ns_admin_fetch_role_requests_v2 and ns_admin_review_role_request_v2.
7. Supabase RLS must permit admins to SELECT profiles and properties; role request functions must validate admin server-side.
8. User and property pages are read-only. Counts are based on up to 1,000 loaded records per table.
9. Never put a Supabase service_role key in frontend files.
