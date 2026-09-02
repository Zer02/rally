-- Add is_admin column to profiles table
-- This fixes the missing is_admin column that causes type mismatches
-- between the Profile type definition and the actual database schema

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Set is_admin to true for existing admins (if any)
-- Note: This assumes there are no existing users with is_admin = true
-- and we want to set it based on some criteria, or leave as false for now.

-- If there are known admins, uncomment and adjust accordingly:
-- ALTER TABLE profiles SET is_admin = TRUE WHERE username IN (
--   'admin', 'superadmin');

-- For now, we just add the column with default FALSE
-- The application logic in useAuth.ts and players.ts will populate is_admin
-- when users are created/updated via the Supabase API.

-- Also add index for performance if needed
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(is_admin);
