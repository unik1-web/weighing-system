/*
# Add INN to company dictionaries + user profiles with roles

1. Changes to shippers, receivers, carriers
   - inn (text): tax identification number for companies.

2. New table: profiles
   - user_id (uuid PK, references auth.users)
   - username (text, unique, not null): login name
   - display_name (text): full name for display
   - role (text, 'user' or 'admin', default 'user')
   - created_at

3. Security
   - is_admin() SECURITY DEFINER function created AFTER the table.
   - RLS: any authenticated user can read profiles; only admins can
     insert/update/delete.
   - Trigger auto-creates a profile row on auth.users insert.

4. Notes
   - Trigger runs as SECURITY DEFINER to insert into profiles during signup.
*/

-- ===== Add inn column to shippers, receivers, carriers =====
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS inn text NOT NULL DEFAULT '';
ALTER TABLE receivers ADD COLUMN IF NOT EXISTS inn text NOT NULL DEFAULT '';
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS inn text NOT NULL DEFAULT '';

-- ===== Profiles table (must exist before is_admin function) =====
CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ===== is_admin() helper (table now exists) =====
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ===== Policies =====
DROP POLICY IF EXISTS "auth_select_profiles" ON profiles;
CREATE POLICY "auth_select_profiles" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_profiles" ON profiles;
CREATE POLICY "auth_insert_profiles" ON profiles FOR INSERT
  TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "auth_update_profiles" ON profiles;
CREATE POLICY "auth_update_profiles" ON profiles FOR UPDATE
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "auth_delete_profiles" ON profiles;
CREATE POLICY "auth_delete_profiles" ON profiles FOR DELETE
  TO authenticated USING (is_admin());

-- ===== Auto-create profile on signup =====
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (user_id, username, display_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', ''),
    'user'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
