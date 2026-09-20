-- Inventory catalog and lifecycle facts used by the Vinhomes Synthetic importer.
-- These additions preserve the existing snapshots contract: snapshots remains the canonical
-- inventory fact consumed by VDaAgent, while the catalog and lifecycle facts retain the
-- additional curated data without changing any business metrics.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS dataset_version TEXT,
  ADD COLUMN IF NOT EXISTS synthetic_marker TEXT;

ALTER TABLE public.imports
  ADD COLUMN IF NOT EXISTS dataset_version TEXT,
  ADD COLUMN IF NOT EXISTS synthetic_marker TEXT;

ALTER TABLE public.snapshots
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS market_external_id TEXT,
  ADD COLUMN IF NOT EXISTS market_name TEXT,
  ADD COLUMN IF NOT EXISTS project_name TEXT,
  ADD COLUMN IF NOT EXISTS zone_name TEXT,
  ADD COLUMN IF NOT EXISTS unit_code TEXT,
  ADD COLUMN IF NOT EXISTS unit_type TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS floor_number INTEGER,
  ADD COLUMN IF NOT EXISTS building_block TEXT,
  ADD COLUMN IF NOT EXISTS view_type TEXT,
  ADD COLUMN IF NOT EXISTS orientation TEXT,
  ADD COLUMN IF NOT EXISTS handover_status TEXT,
  ADD COLUMN IF NOT EXISTS sales_channel TEXT,
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS dataset_version TEXT,
  ADD COLUMN IF NOT EXISTS synthetic_marker TEXT;

CREATE TABLE public.markets (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  market_external_id TEXT NOT NULL,
  market_code TEXT NOT NULL,
  market_name TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, market_external_id),
  UNIQUE (org_id, market_code)
);

CREATE TABLE public.projects (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  project_external_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  market_external_id TEXT NOT NULL,
  project_type TEXT NOT NULL,
  launch_date DATE NOT NULL,
  expected_handover_date DATE NOT NULL,
  total_units INTEGER NOT NULL CHECK (total_units >= 0),
  project_status TEXT NOT NULL,
  price_segment TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, project_external_id),
  UNIQUE (org_id, project_external_id, market_external_id),
  FOREIGN KEY (org_id, market_external_id)
    REFERENCES public.markets(org_id, market_external_id)
);

CREATE TABLE public.zones (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  zone_external_id TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  project_external_id TEXT NOT NULL,
  zone_sequence INTEGER NOT NULL CHECK (zone_sequence > 0),
  building_block_count INTEGER NOT NULL CHECK (building_block_count >= 0),
  total_units INTEGER NOT NULL CHECK (total_units >= 0),
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, zone_external_id),
  UNIQUE (org_id, zone_external_id, project_external_id),
  FOREIGN KEY (org_id, project_external_id)
    REFERENCES public.projects(org_id, project_external_id)
);

CREATE TABLE public.units (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  unit_external_id TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  market_external_id TEXT NOT NULL,
  project_external_id TEXT NOT NULL,
  zone_external_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  area_sqm NUMERIC(20, 6),
  bedrooms INTEGER CHECK (bedrooms >= 0),
  floor_number INTEGER NOT NULL,
  building_block TEXT NOT NULL,
  view_type TEXT NOT NULL,
  orientation TEXT NOT NULL,
  initial_list_price NUMERIC(24, 6),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  launch_date DATE NOT NULL,
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, unit_external_id),
  UNIQUE (org_id, unit_external_id, project_external_id),
  UNIQUE (org_id, unit_external_id, project_external_id, zone_external_id),
  FOREIGN KEY (org_id, market_external_id)
    REFERENCES public.markets(org_id, market_external_id),
  FOREIGN KEY (org_id, project_external_id)
    REFERENCES public.projects(org_id, project_external_id),
  FOREIGN KEY (org_id, zone_external_id, project_external_id)
    REFERENCES public.zones(org_id, zone_external_id, project_external_id)
);

CREATE TABLE public.inventory_transactions (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  transaction_id TEXT NOT NULL,
  unit_external_id TEXT NOT NULL,
  project_external_id TEXT NOT NULL,
  zone_external_id TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_type TEXT NOT NULL,
  transaction_status TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  gross_amount NUMERIC(24, 6) NOT NULL CHECK (gross_amount >= 0),
  discount_amount NUMERIC(24, 6) NOT NULL CHECK (discount_amount >= 0),
  net_amount NUMERIC(24, 6) NOT NULL CHECK (net_amount >= 0),
  payment_method TEXT NOT NULL,
  sales_channel TEXT NOT NULL,
  customer_segment TEXT NOT NULL,
  agent_external_id TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  cancellation_reason TEXT,
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, transaction_id),
  CHECK (gross_amount - discount_amount = net_amount),
  FOREIGN KEY (org_id, unit_external_id, project_external_id, zone_external_id)
    REFERENCES public.units(org_id, unit_external_id, project_external_id, zone_external_id)
);

CREATE TABLE public.unit_price_history (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  price_history_id TEXT NOT NULL,
  unit_external_id TEXT NOT NULL,
  project_external_id TEXT NOT NULL,
  effective_date DATE NOT NULL,
  previous_price NUMERIC(24, 6) CHECK (previous_price IS NULL OR previous_price >= 0),
  new_price NUMERIC(24, 6) NOT NULL CHECK (new_price > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  change_percent NUMERIC(12, 6),
  change_reason TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, price_history_id),
  FOREIGN KEY (org_id, unit_external_id, project_external_id)
    REFERENCES public.units(org_id, unit_external_id, project_external_id)
);

CREATE TABLE public.unit_reservations (
  org_id TEXT NOT NULL REFERENCES public.organizations(org_id),
  reservation_id TEXT NOT NULL,
  unit_external_id TEXT NOT NULL,
  project_external_id TEXT NOT NULL,
  reservation_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  status TEXT NOT NULL,
  deposit_amount NUMERIC(24, 6) NOT NULL CHECK (deposit_amount >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sales_channel TEXT NOT NULL,
  customer_segment TEXT NOT NULL,
  cancellation_reason TEXT,
  dataset_version TEXT NOT NULL,
  synthetic_marker TEXT NOT NULL,
  PRIMARY KEY (org_id, reservation_id),
  CHECK (reservation_date <= expiry_date),
  FOREIGN KEY (org_id, unit_external_id, project_external_id)
    REFERENCES public.units(org_id, unit_external_id, project_external_id)
);

CREATE INDEX snapshots_market_date ON public.snapshots(org_id, market_external_id, snapshot_date DESC);
CREATE INDEX snapshots_project_date ON public.snapshots(org_id, project_external_id, snapshot_date DESC);
CREATE INDEX snapshots_zone_date ON public.snapshots(org_id, zone_external_id, snapshot_date DESC);
CREATE INDEX snapshots_mock_only ON public.snapshots(org_id, snapshot_date DESC)
  WHERE synthetic_marker = 'MOCK_ONLY';
CREATE INDEX projects_market ON public.projects(org_id, market_external_id);
CREATE INDEX zones_project ON public.zones(org_id, project_external_id);
CREATE INDEX units_project ON public.units(org_id, project_external_id);
CREATE INDEX units_zone ON public.units(org_id, zone_external_id);
CREATE INDEX inventory_transactions_unit_date
  ON public.inventory_transactions(org_id, unit_external_id, transaction_date DESC);
CREATE INDEX inventory_transactions_project_date
  ON public.inventory_transactions(org_id, project_external_id, transaction_date DESC);
CREATE INDEX unit_price_history_unit_date
  ON public.unit_price_history(org_id, unit_external_id, effective_date DESC);
CREATE INDEX unit_price_history_project_date
  ON public.unit_price_history(org_id, project_external_id, effective_date DESC);
CREATE INDEX unit_reservations_unit_date
  ON public.unit_reservations(org_id, unit_external_id, reservation_date DESC);
CREATE INDEX unit_reservations_project_date
  ON public.unit_reservations(org_id, project_external_id, reservation_date DESC);

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.markets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.markets TO authenticated;
GRANT ALL ON public.markets TO service_role;
CREATE POLICY workspace_read ON public.markets FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = markets.org_id AND m.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
CREATE POLICY workspace_read ON public.projects FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = projects.org_id AND m.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.zones TO authenticated;
GRANT ALL ON public.zones TO service_role;
CREATE POLICY workspace_read ON public.zones FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = zones.org_id AND m.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.units FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.units TO authenticated;
GRANT ALL ON public.units TO service_role;
CREATE POLICY workspace_read ON public.units FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = units.org_id AND m.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_transactions TO authenticated;
GRANT ALL ON public.inventory_transactions TO service_role;
CREATE POLICY workspace_read ON public.inventory_transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = inventory_transactions.org_id
      AND m.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.unit_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_price_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.unit_price_history TO authenticated;
GRANT ALL ON public.unit_price_history TO service_role;
CREATE POLICY workspace_read ON public.unit_price_history FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = unit_price_history.org_id
      AND m.user_id = (SELECT auth.uid())::text
  ));

ALTER TABLE public.unit_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.unit_reservations TO authenticated;
GRANT ALL ON public.unit_reservations TO service_role;
CREATE POLICY workspace_read ON public.unit_reservations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = unit_reservations.org_id
      AND m.user_id = (SELECT auth.uid())::text
  ));

