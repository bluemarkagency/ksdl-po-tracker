/*
 * Leave SUPABASE_URL and SUPABASE_ANON_KEY blank to use this app entirely in
 * the browser (ideal for a single computer). Fill both values to sync shared
 * data between phones and computers. See README.md for the database setup.
 * The public Supabase key is safe in a browser only when Supabase Row Level
 * Security is enabled. REQUIRE_SECURE_LOGIN turns on the protected login.
 */
window.PO_TRACKER_CONFIG = {
  SUPABASE_URL: 'https://tlashjovostkwziffsjk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_vQtB0Y6QcUK9tC_IaJynyg_UZ7r2kHM',
  // Paste the Google Apps Script Web App URL after deploying manual-gmail-sync-webapp.gs.
  GMAIL_SYNC_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyPDcdGAzWunu7LpCpYEdN5RW2KTWhsC6egIlmE50h2wML7lOQemBnKXInnJYLQ7ViqAw/exec',
  REQUIRE_SECURE_LOGIN: true,
  SIMPLE_PIN: ''
};
