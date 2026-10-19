ALTER TABLE users RENAME COLUMN email_verified_at TO email_registered_at;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = email_registered_at;
