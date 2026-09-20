# Vinhomes Synthetic Demo → Supabase mapping

## Target and scope

- Target: the connected **data warehouse** Supabase project, `public` schema.
- Tenant model: `organizations.org_id`; the source organization UUID is retained as the
  isolated `Vinhomes Synthetic Demo` organization. No existing organization is reused.
- Source boundary: only `vda_vinhomes_mock/curated/` is read. `raw/`, `quarantine/`, and
  the compatibility-only `vda_unit_snapshots.csv` are deliberately excluded.
- Dataset boundary: every imported row has `synthetic_marker = 'MOCK_ONLY'`; imports use
  `WAREHOUSE_DB_URL` only and never fall back to the application database URL.

`snapshots` is the existing canonical inventory fact already consumed by VDaAgent. Its
strict `payload` contract keeps the fields the application reads, while its added physical
columns retain the supplemental curated attributes and support warehouse indexes. The
new catalog and lifecycle tables are normalized additions, not a second copy of inventory.

| Source table | Source column | Target schema | Target table | Target column | Transform | Decision |
|---|---|---|---|---|---|---|
| `dim_organizations` | `org_id` | `public` | `organizations` | `org_id` | Preserve UUID text | DIRECT |
| `dim_organizations` | `organization_name` | `public` | `organizations` | `name` | Rename | RENAME |
| `dim_organizations` | `country_code` | `public` | `organizations` | `country_code` | ISO country code | DIRECT |
| `dim_organizations` | `dataset_version` | `public` | `organizations` | `dataset_version` | Preserve | DIRECT |
| `dim_organizations` | `synthetic_marker` | `public` | `organizations` | `synthetic_marker` | Must equal `MOCK_ONLY` | DIRECT |
| `dim_markets` | `market_external_id` | `public` | `markets` | `market_external_id` | Preserve deterministic UUID | DIRECT |
| `dim_markets` | `market_code`, `market_name` | `public` | `markets` | `market_code`, `market_name` | Preserve | DIRECT |
| `dim_markets` | `country_code`, `currency` | `public` | `markets` | `country_code`, `currency` | Preserve ISO codes | DIRECT |
| `dim_markets` | `dataset_version`, `synthetic_marker` | `public` | `markets` | `dataset_version`, `synthetic_marker` | Preserve; marker required | DIRECT |
| `dim_projects` | `project_external_id` | `public` | `projects` | `project_external_id` | Preserve deterministic UUID | DIRECT |
| `dim_projects` | `project_name`, `project_type`, `project_status`, `price_segment` | `public` | `projects` | same names | Preserve | DIRECT |
| `dim_projects` | `market_external_id` | `public` | `projects` | `market_external_id` | FK to `markets` within `org_id` | DIRECT |
| `dim_projects` | `market_name` | `public` | `markets` | `market_name` | Repeated attribute; canonical value is imported from `dim_markets` | SOURCE_UNUSED |
| `dim_projects` | `launch_date`, `expected_handover_date` | `public` | `projects` | same names | CSV ISO date → `DATE` | TRANSFORM |
| `dim_projects` | `total_units` | `public` | `projects` | `total_units` | CSV integer → `INTEGER` | TRANSFORM |
| `dim_projects` | `synthetic_marker` | `public` | `projects` | `synthetic_marker` | Must equal `MOCK_ONLY` | DIRECT |
| `dim_projects` | _no source column_ | `public` | `projects` | `dataset_version` | Read from validated `manifest.json` | GENERATED |
| `dim_zones` | `zone_external_id` | `public` | `zones` | `zone_external_id` | Preserve deterministic UUID | DIRECT |
| `dim_zones` | `zone_name`, `zone_sequence`, `building_block_count`, `total_units` | `public` | `zones` | same names | Integer fields cast to `INTEGER` | TRANSFORM |
| `dim_zones` | `project_external_id` | `public` | `zones` | `project_external_id` | Tenant-scoped FK to `projects` | DIRECT |
| `dim_zones` | `project_name` | `public` | `projects` | `project_name` | Repeated attribute; canonical value is imported from `dim_projects` | SOURCE_UNUSED |
| `dim_zones` | `dataset_version`, `synthetic_marker` | `public` | `zones` | same names | Preserve; marker required | DIRECT |
| `dim_units` | `unit_external_id` | `public` | `units` | `unit_external_id` | Preserve deterministic UUID | DIRECT |
| `dim_units` | `org_id` | `public` | `units` | `org_id` | Must equal isolated mock organization UUID | DIRECT |
| `dim_units` | `market_external_id`, `project_external_id`, `zone_external_id` | `public` | `units` | same names | Tenant-scoped catalog FKs | DIRECT |
| `dim_units` | `unit_code`, `unit_type`, `building_block`, `view_type`, `orientation` | `public` | `units` | same names | Preserve | DIRECT |
| `dim_units` | `area_sqm`, `initial_list_price` | `public` | `units` | same names | Empty → `NULL`; decimal string → `NUMERIC(20/24,6)` | TRANSFORM |
| `dim_units` | `bedrooms`, `floor_number` | `public` | `units` | same names | Empty → `NULL` for bedrooms; CSV integer → `INTEGER` | TRANSFORM |
| `dim_units` | `currency`, `launch_date`, `dataset_version`, `synthetic_marker` | `public` | `units` | same names | ISO code/date preserved; marker required | TRANSFORM |
| `dim_dates` | `date`, `year`, `month`, `day`, `iso_week`, `day_name`, `is_weekend`, `dataset_version`, `synthetic_marker` | — | — | — | The VDaAgent model uses native `DATE` columns, not a date dimension | SOURCE_UNUSED |
| `fact_inventory_snapshot` | `org_id` | `public` | `snapshots` | `org_id`, `payload.org_id` | Retain tenant UUID | DIRECT |
| `fact_inventory_snapshot` | `snapshot_id` | `public` | `snapshots` | `id`, `payload.snapshot_id` | Preserve deterministic UUID | RENAME |
| `fact_inventory_snapshot` | `import_id` | `public` | `snapshots` | `import_id`, `payload.import_id` | Preserve deterministic UUID and FK to `imports` | DIRECT |
| `fact_inventory_snapshot` | `snapshot_date` | `public` | `snapshots` | `snapshot_date`, `payload.snapshot_date` | CSV ISO date → `DATE`; payload remains contract-compatible | TRANSFORM |
| `fact_inventory_snapshot` | `market_external_id`, `project_external_id`, `zone_external_id`, `unit_external_id` | `public` | `snapshots` | same physical columns and matching `payload.*` | Preserve stable external IDs | DIRECT |
| `fact_inventory_snapshot` | `market_name`, `project_name`, `zone_name`, `unit_code`, `unit_type` | `public` | `snapshots` | same physical columns and matching `payload.*` | Preserve descriptive fields | DIRECT |
| `fact_inventory_snapshot` | `area_sqm`, `list_price` | `public` | `snapshots` | `payload.*`; generated `area_sqm`, `list_price` columns | Empty → JSON `null`; stored generated columns are `NUMERIC` | GENERATED |
| `fact_inventory_snapshot` | `currency`, `status`, `available_since`, `sold_at`, `bedrooms` | `public` | `snapshots` | `currency`; matching `payload.*` | Empty lifecycle/decimal fields → JSON `null`; bedrooms → integer | TRANSFORM |
| `fact_inventory_snapshot` | `country_code`, `floor_number`, `building_block`, `view_type`, `orientation`, `handover_status`, `sales_channel`, `source_system`, `batch_id` | `public` | `snapshots` | same physical columns | Preserve supplemental snapshot attributes | TRANSFORM |
| `fact_inventory_snapshot` | `dataset_version`, `synthetic_marker` | `public` | `snapshots` | same physical columns | Preserve; marker is import scope | DIRECT |
| `fact_transaction` | `transaction_id` | `public` | `inventory_transactions` | `transaction_id` | Preserve deterministic UUID | DIRECT |
| `fact_transaction` | `org_id`, `unit_external_id`, `project_external_id`, `zone_external_id` | `public` | `inventory_transactions` | same names | Preserve; composite tenant-scoped FK to `units` | DIRECT |
| `fact_transaction` | `transaction_date` | `public` | `inventory_transactions` | `transaction_date` | CSV ISO date → `DATE` | TRANSFORM |
| `fact_transaction` | `transaction_type`, `transaction_status`, `payment_method`, `sales_channel`, `customer_segment`, `agent_external_id`, `contract_type` | `public` | `inventory_transactions` | same names | Preserve | DIRECT |
| `fact_transaction` | `currency`, `gross_amount`, `discount_amount`, `net_amount` | `public` | `inventory_transactions` | same names | ISO currency; decimal strings → `NUMERIC(24,6)` | TRANSFORM |
| `fact_transaction` | `cancellation_reason` | `public` | `inventory_transactions` | `cancellation_reason` | Empty → `NULL` | TRANSFORM |
| `fact_transaction` | `dataset_version`, `synthetic_marker` | `public` | `inventory_transactions` | same names | Preserve; marker required | DIRECT |
| `fact_price_history` | `price_history_id` | `public` | `unit_price_history` | `price_history_id` | Preserve deterministic UUID | DIRECT |
| `fact_price_history` | `org_id`, `unit_external_id`, `project_external_id` | `public` | `unit_price_history` | same names | Preserve; tenant-scoped FK to `units` | DIRECT |
| `fact_price_history` | `effective_date` | `public` | `unit_price_history` | `effective_date` | CSV ISO date → `DATE` | TRANSFORM |
| `fact_price_history` | `previous_price`, `new_price`, `change_percent` | `public` | `unit_price_history` | same names | Empty nullable values → `NULL`; decimal strings → `NUMERIC` | TRANSFORM |
| `fact_price_history` | `currency`, `change_reason`, `approved_by`, `dataset_version`, `synthetic_marker` | `public` | `unit_price_history` | same names | Preserve; marker required | DIRECT |
| `fact_reservation` | `reservation_id` | `public` | `unit_reservations` | `reservation_id` | Preserve deterministic UUID | DIRECT |
| `fact_reservation` | `org_id`, `unit_external_id`, `project_external_id` | `public` | `unit_reservations` | same names | Preserve; tenant-scoped FK to `units` | DIRECT |
| `fact_reservation` | `reservation_date`, `expiry_date` | `public` | `unit_reservations` | same names | CSV ISO date → `DATE` | TRANSFORM |
| `fact_reservation` | `status`, `currency`, `sales_channel`, `customer_segment` | `public` | `unit_reservations` | same names | Preserve | DIRECT |
| `fact_reservation` | `deposit_amount` | `public` | `unit_reservations` | `deposit_amount` | Decimal string → `NUMERIC(24,6)` | TRANSFORM |
| `fact_reservation` | `cancellation_reason` | `public` | `unit_reservations` | `cancellation_reason` | Empty → `NULL` | TRANSFORM |
| `fact_reservation` | `dataset_version`, `synthetic_marker` | `public` | `unit_reservations` | same names | Preserve; marker required | DIRECT |
| `vda_unit_snapshots` | all columns | — | — | — | Latest-snapshot compatibility extract is already represented in `fact_inventory_snapshot_*` | SOURCE_UNUSED |

## Integrity, indexing, and authorization decisions

- `projects → markets`, `zones → projects`, `units → markets/projects/zones`, and each
  lifecycle fact → `units` use tenant-scoped composite foreign keys. `snapshots` retains
  the application’s existing shape so normal CSV imports stay backward compatible; the
  importer and post-import validator explicitly check its unit/project/zone references.
- Primary keys preserve all deterministic source UUIDs. Import operations use only
  `ON CONFLICT DO NOTHING`, never an update, so reruns cannot overwrite a non-mock row.
- Money and decimal quantities use `NUMERIC`, never `REAL` or `FLOAT`. Query indexes cover
  tenant plus market/project/zone/unit and event date; `snapshots` retains the existing
  latest-per-unit index and gains market/project/zone date indexes.
- New public tables use the established read-only `workspace_read` policy through
  `organization_members`; RLS is enabled and `anon`/`authenticated` grants are revoked
  before the authenticated `SELECT` grant is restored. The importer connects as a trusted
  server process but does not disable RLS or create client write policies.
