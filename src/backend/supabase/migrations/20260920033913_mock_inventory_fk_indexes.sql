-- Cover tenant-scoped foreign keys without replacing the date-oriented warehouse indexes.
CREATE INDEX units_market ON public.units(org_id, market_external_id);
CREATE INDEX units_zone_project ON public.units(org_id, zone_external_id, project_external_id);
CREATE INDEX inventory_transactions_unit_project_zone
  ON public.inventory_transactions(org_id, unit_external_id, project_external_id, zone_external_id);
CREATE INDEX unit_price_history_unit_project
  ON public.unit_price_history(org_id, unit_external_id, project_external_id);
CREATE INDEX unit_reservations_unit_project
  ON public.unit_reservations(org_id, unit_external_id, project_external_id);

