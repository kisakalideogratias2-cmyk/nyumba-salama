NYUMBA SALAMA — cloud.js recovery / comparison report

ROOT CAUSE FOUND
The previous notification-fix cloud.js was based on the older cloud.js and did not export rental APIs required by the newer app.js. Specifically, it lacked createRentalRequest, loadMyRentalRequests, loadOwnerRentalRequests, updateRentalRequestStatus, and reviewRoleRequest. As a result, tenant Rental and landlord/Owner screens could fail completely when app.js called these missing methods.

WHAT THIS BUILD DOES
- Uses the prior cloud.js version paired with the Tenant/Landlord dashboard app.js as the base.
- Preserves auth, profiles, role requests, property listing/CRUD, media upload, and rental request functions.
- Adds loadNotifications, getUnreadNotificationCount, markNotificationAsRead, markAllNotificationsAsRead and exposes all four on window.NS_CLOUD.
- Keeps app.js and Supabase database unchanged.
- Includes cloud_original_user_backup.js for reference only; do not rename it to cloud.js.

INSTALL
1. Make a backup of the currently installed cloud.js.
2. Replace only cloud.js with this build's cloud.js.
3. Do not replace app.js or change Supabase SQL during this test.
4. Reload the site fully and check login, Rental, Owner, and Notifications.

VALIDATION
JavaScript syntax and required API exports were checked locally. This is not a live browser/Supabase integration test. If the sections still fail, capture the first red error from browser DevTools Console and share it.
