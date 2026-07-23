/*
# Vehicle Scale Weighing System Schema (single-tenant, no auth)

1. Purpose
   Application for vehicle weighing at a waste polygon using a Microsim M0601
   weighing indicator. Supports weight entry from the instrument (via serial
   port) or manually. Stores reference data in dictionaries for dropdown
   selection.

2. New Tables
   - `vehicles` — dictionary of vehicle numbers with optional default tare weight
     - id (uuid PK), vehicle_number (text, unique, not null), default_tare_weight (numeric, kg, nullable), notes (text), created_at
   - `drivers` — dictionary of driver names
     - id (uuid PK), name (text, unique, not null), notes (text), created_at
   - `cargos` — dictionary of cargo types with default reception price
     - id (uuid PK), name (text, unique, not null), default_price (numeric, price per ton, nullable), notes (text), created_at
   - `shippers` — dictionary of cargo senders
     - id (uuid PK), name (text, unique, not null), notes (text), created_at
   - `receivers` — dictionary of cargo receivers
     - id (uuid PK), name (text, unique, not null), notes (text), created_at
   - `carriers` — dictionary of transport companies
     - id (uuid PK), name (text, unique, not null), notes (text), created_at
   - `weighing_tickets` — main weighing operation records
     - id (uuid PK), ticket_number (bigint, generated identity), vehicle_number, driver_name, cargo_name, shipper_name, receiver_name, carrier_name, price (numeric per ton), gross_weight (numeric kg), tare_weight (numeric kg), net_weight (numeric kg, computed), total_amount (numeric, computed), gross_source (text: manual|instrument), tare_source (text), gross_raw (text), tare_raw (text), status (text: open|completed), notes (text), created_at, completed_at

3. Security
   - RLS enabled on all tables.
   - All policies use `TO anon, authenticated` because this is a single-tenant
     industrial workstation app with no sign-in screen. Data is intentionally
     shared/public within the workstation.

4. Important Notes
   - net_weight and total_amount are stored as computed values at insert/update
     time by the application, not as generated columns, to keep the logic
     transparent and avoid migration constraints.
   - ticket_number uses IDENTITY for auto-incrementing sequential numbering.
*/

-- ==================== VEHICLES ====================
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number text UNIQUE NOT NULL,
  default_tare_weight numeric(12,2),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_vehicles" ON vehicles;
CREATE POLICY "anon_select_vehicles" ON vehicles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vehicles" ON vehicles;
CREATE POLICY "anon_insert_vehicles" ON vehicles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vehicles" ON vehicles;
CREATE POLICY "anon_update_vehicles" ON vehicles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vehicles" ON vehicles;
CREATE POLICY "anon_delete_vehicles" ON vehicles FOR DELETE TO anon, authenticated USING (true);

-- ==================== DRIVERS ====================
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_drivers" ON drivers;
CREATE POLICY "anon_select_drivers" ON drivers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_drivers" ON drivers;
CREATE POLICY "anon_insert_drivers" ON drivers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_drivers" ON drivers;
CREATE POLICY "anon_update_drivers" ON drivers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_drivers" ON drivers;
CREATE POLICY "anon_delete_drivers" ON drivers FOR DELETE TO anon, authenticated USING (true);

-- ==================== CARGOS ====================
CREATE TABLE IF NOT EXISTS cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  default_price numeric(12,2),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE cargos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_cargos" ON cargos;
CREATE POLICY "anon_select_cargos" ON cargos FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_cargos" ON cargos;
CREATE POLICY "anon_insert_cargos" ON cargos FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_cargos" ON cargos;
CREATE POLICY "anon_update_cargos" ON cargos FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_cargos" ON cargos;
CREATE POLICY "anon_delete_cargos" ON cargos FOR DELETE TO anon, authenticated USING (true);

-- ==================== SHIPPERS ====================
CREATE TABLE IF NOT EXISTS shippers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE shippers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_shippers" ON shippers;
CREATE POLICY "anon_select_shippers" ON shippers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_shippers" ON shippers;
CREATE POLICY "anon_insert_shippers" ON shippers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_shippers" ON shippers;
CREATE POLICY "anon_update_shippers" ON shippers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_shippers" ON shippers;
CREATE POLICY "anon_delete_shippers" ON shippers FOR DELETE TO anon, authenticated USING (true);

-- ==================== RECEIVERS ====================
CREATE TABLE IF NOT EXISTS receivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE receivers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_receivers" ON receivers;
CREATE POLICY "anon_select_receivers" ON receivers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_receivers" ON receivers;
CREATE POLICY "anon_insert_receivers" ON receivers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_receivers" ON receivers;
CREATE POLICY "anon_update_receivers" ON receivers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_receivers" ON receivers;
CREATE POLICY "anon_delete_receivers" ON receivers FOR DELETE TO anon, authenticated USING (true);

-- ==================== CARRIERS ====================
CREATE TABLE IF NOT EXISTS carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_carriers" ON carriers;
CREATE POLICY "anon_select_carriers" ON carriers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_carriers" ON carriers;
CREATE POLICY "anon_insert_carriers" ON carriers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_carriers" ON carriers;
CREATE POLICY "anon_update_carriers" ON carriers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_carriers" ON carriers;
CREATE POLICY "anon_delete_carriers" ON carriers FOR DELETE TO anon, authenticated USING (true);

-- ==================== WEIGHING TICKETS ====================
CREATE TABLE IF NOT EXISTS weighing_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number bigint GENERATED BY DEFAULT AS IDENTITY,
  vehicle_number text NOT NULL,
  driver_name text NOT NULL,
  cargo_name text NOT NULL,
  shipper_name text NOT NULL,
  receiver_name text NOT NULL,
  carrier_name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  gross_weight numeric(12,2),
  tare_weight numeric(12,2),
  net_weight numeric(12,2),
  total_amount numeric(14,2),
  gross_source text DEFAULT 'manual',
  tare_source text DEFAULT 'manual',
  gross_raw text,
  tare_raw text,
  status text NOT NULL DEFAULT 'open',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE weighing_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_tickets" ON weighing_tickets;
CREATE POLICY "anon_select_tickets" ON weighing_tickets FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_tickets" ON weighing_tickets;
CREATE POLICY "anon_insert_tickets" ON weighing_tickets FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_tickets" ON weighing_tickets;
CREATE POLICY "anon_update_tickets" ON weighing_tickets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_tickets" ON weighing_tickets;
CREATE POLICY "anon_delete_tickets" ON weighing_tickets FOR DELETE TO anon, authenticated USING (true);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_weighing_tickets_created_at ON weighing_tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_weighing_tickets_status ON weighing_tickets (status);
CREATE INDEX IF NOT EXISTS idx_weighing_tickets_vehicle ON weighing_tickets (vehicle_number);