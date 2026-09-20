# Inventory analytics specification v0.2

Semantic version: `mvp-inventory-v0.2`  
Status: provisional pending BA/Data Owner validation

## Deterministic truth boundary

All numeric outputs are calculated by `@vda/semantic` from frozen, tenant-scoped snapshot evidence. The planner selects registered modules; it does not author formulas or SQL. The LLM receives only deterministic claim IDs and metric keys, and its output is rejected if it adds, removes, duplicates, or changes a claim. Null means unavailable and is never converted to zero.

The point-in-time rule is: for each unit, select the latest snapshot at or before the requested date, then apply the requested project/zone scope. Historical targets use the same rule and do not require an exact-date snapshot.

## Metric registry

The executable registry is `src/backend/packages/semantic/src/registry.ts`. Every entry records its meaning, required fields, unit, supported scopes/dimensions, trend support, aggregation, null behavior, and semantic version.

| Metric group | Keys | Formula / null behavior |
| --- | --- | --- |
| Inventory | `total_inventory`, `available_inventory`, `available_inventory_rate` | Latest distinct units; status=`available`; available / total. No snapshot and zero denominators abstain. |
| Snapshot-reported sales | `sold_units_7d`, `sold_units_30d`, `sold_units_90d` | Latest units whose non-null `sold_at` falls in the inclusive N-day window ending `data_as_of`. This is not an authoritative transaction-ledger measure. |
| Inventory movement | `inventory_change_7d`, `inventory_change_30d`, `inventory_change_90d` | Current available inventory minus available inventory at the prior as-of selection. Missing history abstains. |
| Aging | `median_inventory_age_days`, `p75_inventory_age_days`, `slow_moving_units`, `slow_moving_rate`, `unknown_inventory_age`, `unknown_inventory_age_rate` | Age is `data_as_of - available_since` for available units. Slow rate uses known-age available units. Missing age is explicit. |
| Price | `median_price`, `median_price_per_area`, `p25_price_per_area`, `p75_price_per_area`, `price_per_area_iqr` | Decimal median/linear percentiles over positive usable values for available units. Multiple currencies abstain. IQR = p75 - p25. |
| Data quality | `missing_inventory_age_rate`, `missing_price_rate`, `missing_area_rate`, `records_with_invalid_or_unusable_values`, `snapshot_coverage` | Explicit missing/unusable counts and ratios. Coverage is units present on the newest selected date / current latest-unit population. No composite quality score is produced. |

Rate values are percentages from 0 to 100. Rate comparisons expose both relative percent change and percentage-point change. A zero prior value does not invalidate an absolute or percentage-point delta; only the relative delta abstains with `ZERO_DENOMINATOR`. Monetary and area-derived calculations use `decimal.js` with 50-digit precision and half-up six-decimal output. Every available monetary metric carries an ISO currency code, and time/segment comparisons abstain when currencies differ.

## Aging buckets

Available inventory is assigned deterministically to exactly one bucket: `0-30`, `31-60`, `61-90`, `91-180`, `>180`, or `unknown`. The default slow-moving threshold is 90 days and remains organization-configurable. Both choices are provisional business assumptions.

## Breakdowns

Snapshot-backed breakdowns support `zone`, `unit_type`, `bedrooms`, and `status` for total inventory, available inventory, available rate, slow-moving rate, median age, and median price per area. Project is the enclosing scope. Results sort segment keys lexicographically and retain scope, filter, `data_as_of`, newest contributing snapshot date, snapshot/import references, semantic version, currency metadata, and limitations. Additive count breakdowns reconcile to the scoped total; medians and rates are recalculated per group and are not summed.

## Comparisons

- Time: 7/30/90-day typed comparisons contain current/prior values, absolute delta, relative delta, percentage-point delta for rates, effective dates, snapshot references, and abstention.
- Segment: each sorted segment is compared with the first stable segment key; no opaque “best” score is created.
- Unit peer: same organization, project, zone, unit type, bedrooms, and currency; area within inclusive +/-15%; target excluded; minimum three peers. Cohorts never widen silently.
- Portfolio comparison remains unsupported because the request contract is project-scoped.

## Notable changes and insight selection

Rule set `notable-change-v0.2` is explicit and provisional:

- available inventory: at least 10% relative movement;
- rates: at least 5 percentage points;
- median price per area: at least 10% relative movement.

Severity is `material` at 20% relative movement or 10 percentage points; otherwise an eligible change is `watch`. Eligible changes become evidence-bound candidates. Priority bases are 100 for material changes, 70 for watch changes, 50 for current slow-moving rate, 40 for current missing-age rate, and 30 for current available rate; stable order offsets break ties. Selection keeps one candidate per metric and at most five. These constants live in the semantic rule registry rather than report or UI code. The LLM may only preserve/reorder the selected claim IDs and cannot create analytical facts or causes.

Each selected claim has exactly one evidence path. Validation resolves that path against the immutable calculation artifact, verifies its metric key and value, and rejects invented IDs, duplicate IDs, unsupported paths, added fields, or fabricated values.

## Report and visual evidence

Reports contain Executive Summary, Inventory Overview, Trend, Aging Analysis, Price Analysis, Segment Analysis, Comparison, Data Quality & Limitations, and Evidence / Lineage section descriptors. Every section references existing artifacts and registered metrics. Missing analytics are marked limited/unavailable. Aging sections, candidates, and charts surface the known missing-age population rather than presenting partial-age results without qualification.

Visual evidence rule set `chart-rules-v0.2` builds KPI, trend, aging, segment, composition, price-quartile, and peer-comparison charts only from validated calculation/comparison values. Trend x-values are the requested as-of targets; each y-value uses the latest snapshot at or before that target. `comparison_snapshot_date` remains lineage metadata for the newest contributing snapshot and is not relabeled as the observation date. Empty age buckets do not produce a chart. No chart point is generated by the LLM.

## Versioning

The semantic formulas remain `mvp-inventory-v0.2`; this hardening aligns zero-baseline availability, currency compatibility, and evidence validation with the already documented v0.2 definitions. Persisted artifacts are schema `1.1` because currency metadata and typed delta-abstention fields materially extend the payload contract. Chart selection/date-label behavior changed materially, so the chart rules version is explicitly `chart-rules-v0.2`. The structural chart contract remains `chart-spec-v1`.

## Unsupported / deferred

Authoritative sales velocity, reservation conversion, and price-change-event analysis require the transaction/reservation/price-history facts to be added to frozen analytical query artifacts. Freshness/staleness requires an approved expected cadence/SLA. Causal claims require validated driver data and an approved causal method. These outputs abstain rather than being inferred.
