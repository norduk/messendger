-- Add admin_key and admin_secret_path columns to existing users
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_key VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_secret_path VARCHAR(32);
