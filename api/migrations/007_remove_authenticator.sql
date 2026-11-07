-- Staff sign in with email and password only (the authenticator app step was removed).
ALTER TABLE admins
  DROP COLUMN totp_secret,
  DROP COLUMN totp_enabled,
  DROP COLUMN totp_last_step,
  DROP COLUMN recovery_codes;
ALTER TABLE admin_sessions DROP COLUMN mfa_passed;
