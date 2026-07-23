/*
# Extend weighing schema: auth, multi-device, act fields

1. Changes to weighing_tickets
   - operator_id (uuid): references auth.users, tracks who created the record
   - operator_name (text): display name of the weighmaster (denormalized for reports)
   - scale_device (text): device model used (Microsim M0601 / Newton / CAS / Midl Mi VDA)
   - vehicle_brand (text): make/model of the truck (for the act)
   - trailer_number (text): trailer registration number
   - gross_datetime (timestamptz): moment the gross weight was captured
   - tare_datetime (timestamptz): moment the tare weight was captured
   - vat_rate (numeric): VAT rate % stored at time of weighing (e.g. 20)

2. Changes to vehicles dictionary
   - vehicle_brand (text): default brand/make pre-filled from dictionary

3. New table: settings
   - Single-row key/value store for organisation-level config (org_name, etc.)

4. RLS changes
   - All tables switched from TO anon, authenticated → TO authenticated
     because auth is now required to use the application.
   - settings uses USING (true) / WITH CHECK (true) so any logged-in user
     can read/write shared config.

5. Important notes
   - operator_id has DEFAULT auth.uid() so inserts omitting the column still pass RLS.
   - Existing rows keep NULL for new columns — no data is lost.
*/

-- ===== weighing_tickets new columns =====
ALTER TABLE weighing_tickets
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS operator_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scale_device text NOT NULL DEFAULT 'Microsim M0601',
  ADD COLUMN IF NOT EXISTS vehicle_brand text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS trailer_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gross_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS tare_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 0;

-- ===== vehicles new column =====
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS vehicle_brand text NOT NULL DEFAULT '';

-- ===== settings table =====
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_select_settings" ON settings;
CREATE POLICY "auth_select_settings" ON settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_settings" ON settings;
CREATE POLICY "auth_insert_settings" ON settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_settings" ON settings;
CREATE POLICY "auth_update_settings" ON settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_settings" ON settings;
CREATE POLICY "auth_delete_settings" ON settings FOR DELETE TO authenticated USING (true);

-- Seed default org name
INSERT INTO settings (key, value) VALUES ('org_name', '') ON CONFLICT (key) DO NOTHING;

-- ===== Switch all table RLS to authenticated =====

-- vehicles
DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
CREATE POLICY "auth_select_vehicles" ON vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_vehicles" ON vehicles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_vehicles" ON vehicles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_vehicles" ON vehicles FOR DELETE TO authenticated USING (true);

-- drivers
DROP POLICY IF EXISTS "anon_select_drivers" ON drivers;
DROP POLICY IF EXISTS "anon_insert_drivers" ON drivers;
DROP POLICY IF EXISTS "anon_update_drivers" ON drivers;
DROP POLICY IF EXISTS "anon_delete_drivers" ON drivers;
CREATE POLICY "auth_select_drivers" ON drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_drivers" ON drivers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_drivers" ON drivers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_drivers" ON drivers FOR DELETE TO authenticated USING (true);

-- cargos
DROP POLICY IF EXISTS "anon_select_cargos" ON cargos;
DROP POLICY IF EXISTS "anon_insert_cargos" ON cargos;
DROP POLICY IF EXISTS "anon_update_cargos" ON cargos;
DROP POLICY IF EXISTS "anon_delete_cargos" ON cargos;
CREATE POLICY "auth_select_cargos" ON cargos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_cargos" ON cargos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_cargos" ON cargos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_cargos" ON cargos FOR DELETE TO authenticated USING (true);

-- shippers
DROP POLICY IF EXISTS "anon_select_shippers" ON shippers;
DROP POLICY IF EXISTS "anon_insert_shippers" ON shippers;
DROP POLICY IF EXISTS "anon_update_shippers" ON shippers;
DROP POLICY IF EXISTS "anon_delete_shippers" ON shippers;
CREATE POLICY "auth_select_shippers" ON shippers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_shippers" ON shippers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_shippers" ON shippers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_shippers" ON shippers FOR DELETE TO authenticated USING (true);

-- receivers
DROP POLICY IF EXISTS "anon_select_receivers" ON receivers;
DROP POLICY IF EXISTS "anon_insert_receivers" ON receivers;
DROP POLICY IF EXISTS "anon_update_receivers" ON receivers;
DROP POLICY IF EXISTS "anon_delete_receivers" ON receivers;
CREATE POLICY "auth_select_receivers" ON receivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_receivers" ON receivers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_receivers" ON receivers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_receivers" ON receivers FOR DELETE TO authenticated USING (true);

-- carriers
DROP POLICY IF EXISTS "anon_select_carriers" ON carriers;
DROP POLICY IF EXISTS "anon_insert_carriers" ON carriers;
DROP POLICY IF EXISTS "anon_update_carriers" ON carriers;
DROP POLICY IF EXISTS "anon_delete_carriers" ON carriers;
CREATE POLICY "auth_select_carriers" ON carriers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_carriers" ON carriers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_carriers" ON carriers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_carriers" ON carriers FOR DELETE TO authenticated USING (true);

-- weighing_tickets
DROP POLICY IF EXISTS "anon_select_tickets" ON weighing_tickets;
DROP POLICY IF EXISTS "anon_insert_tickets" ON weighing_tickets;
DROP POLICY IF EXISTS "anon_update_tickets" ON weighing_tickets;
DROP POLICY IF EXISTS "anon_delete_tickets" ON weighing_tickets;
CREATE POLICY "auth_select_tickets" ON weighing_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_tickets" ON weighing_tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_tickets" ON weighing_tickets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_tickets" ON weighing_tickets FOR DELETE TO authenticated USING (true);
