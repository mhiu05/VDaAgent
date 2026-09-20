# Phase 1 analytics implementation audit

Date: 2026-09-20  
Target semantic version: `mvp-inventory-v0.2`

## Existing

- The deterministic semantic package selects the latest unit snapshot at or before `data_as_of`, calculates `available_inventory`, snapshot-reported `sold_units_30d`, `slow_moving_units`, and `unknown_inventory_age`, and derives decimal `price_per_sqm` per unit.
- Inventory means latest-per-unit rows in scope; available inventory means rows whose latest status is `available`. The slow-moving threshold is organization-configured and defaults to 90 days.
- Unit peer comparison uses the same organization, project, zone, unit type, bedroom count, and currency; area must be within +/-15%; the subject is excluded and at least three peers are required.
- Runs freeze snapshot membership at enqueue time. Artifacts are immutable, hashed, tenant-scoped, versioned, and linked to query, snapshot, and import lineage.
- The current pipeline creates one authoritative calculation artifact, typed time/segment/unit comparisons, deterministic visual evidence, an evidence-bound insight artifact, and a sectioned report payload.
- LLM providers receive claim IDs and metric keys only. Provider output cannot introduce claim IDs or numeric values.
- Current breakdown dimensions present in the canonical snapshot contract are project, zone, unit type, bedrooms, and status.
- The mock warehouse contains 10 dated inventory snapshots for 60,000 units across 12 projects and 300 zones, plus transaction, price-history, and reservation facts. It includes null area, price, age, and bedroom values as well as segment and lifecycle variation.

## Implemented from canonical snapshots

- Explicit total and available inventory rates.
- 7/30/90-day inventory movement using latest-snapshot-at-or-before target dates.
- Median and p75 inventory age, unknown-age rate, slow-moving rate, deterministic age buckets, and propagated missing-age limitations.
- Currency-tagged median price, median/p25/p75 price per area, and price-per-area IQR using decimal arithmetic.
- Missing age, price, and area rates plus invalid/unusable-value counts.
- Stable breakdowns by zone, unit type, bedrooms, and status with reconciliation, lineage, filters, limitations, snapshot dates, and currency compatibility.
- Typed period comparisons, segment comparisons, deterministic notable-change rules, candidate generation, deterministic top-N insight selection, and report sections.
- KPI, line, bar, donut, quartile, and peer visual evidence derived only from validated calculation/comparison outputs.

## Unsupported in the current analysis query

| Desired metric | Missing required data in the current query contract | Required field/source |
| --- | --- | --- |
| Authoritative sold units over 7/30/90 days | Completed/confirmed sales events are not read by the pipeline; snapshot `sold_at` is nullable and is not a transaction ledger | Tenant/scope-filtered `inventory_transactions.transaction_date`, `transaction_type`, and `transaction_status` query with frozen lineage |
| Sales decline notable change | Historical authoritative sales counts are unavailable to the calculation artifact | The transaction-series source above |
| Reservation conversion/cancellation analytics | Reservation lifecycle facts are not included in analytical query artifacts | Tenant/scope-filtered `unit_reservations` source with frozen lineage |
| Price-change event analytics | Price-history events are not included in analytical query artifacts | Tenant/scope-filtered `unit_price_history` source with frozen lineage |
| Freshness SLA / stale snapshot rate | No approved freshness SLA or expected snapshot cadence exists | Versioned business SLA/cadence configuration |
| Portfolio-wide project comparison | The request scope requires one project and the frozen query is project-scoped | A typed portfolio scope and aligned multi-project query |
| Causes of inventory or price movement | No causal explanatory variables or approved causal model exist | Validated operational drivers and an approved causal methodology |

The implementation will use snapshot status transitions only for inventory state and historical inventory comparisons. It will not relabel those transitions as authoritative sales events.
