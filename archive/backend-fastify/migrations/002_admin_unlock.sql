-- Phone verification is set aside for now, and a wrong-PIN lockout no longer expires on its own:
-- after too many wrong PINs the account stays locked until an administrator reactivates it.
DROP TABLE IF EXISTS otp_codes;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users ADD COLUMN locked_at timestamptz;
