import { percentile, positive, pricePerArea } from '../core/decimal';
import { semanticPack } from '../pack';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import type { ComparisonItem } from '@vda/contracts/analysis/calculation';
import type { AbstentionReason } from '@vda/contracts/analysis/metrics';

export function compare(rows: UnitSnapshot[]): ComparisonItem[] {
  return rows.map((target) => {
    const targetPrice = pricePerArea(target);
    const targetArea = positive(target.area_sqm);
    const peers = !targetArea
      ? []
      : rows
          .filter((peer) => {
            if (
              peer.unit_external_id === target.unit_external_id ||
              peer.org_id !== target.org_id ||
              peer.project_external_id !== target.project_external_id ||
              peer.zone_external_id !== target.zone_external_id ||
              peer.unit_type !== target.unit_type ||
              peer.bedrooms !== target.bedrooms ||
              peer.currency !== target.currency ||
              !positive(peer.area_sqm) ||
              !pricePerArea(peer)
            )
              return false;
            const area = positive(peer.area_sqm)!;
            return area.gte(targetArea.mul('0.85')) && area.lte(targetArea.mul('1.15'));
          })
          .sort((a, b) => a.unit_external_id.localeCompare(b.unit_external_id));
    let reason: AbstentionReason | null = targetPrice
      ? peers.length < 3
        ? 'INSUFFICIENT_PEERS'
        : null
      : 'MISSING_REQUIRED_FIELD';
    const median = percentile(
      peers.map((peer) => pricePerArea(peer)!),
      0.5,
    );
    if (!reason && (!median || !median.gt(0))) reason = 'ZERO_DENOMINATOR';
    return {
      unit_external_id: target.unit_external_id,
      currency: target.currency,
      peer_ids: peers.map((peer) => peer.unit_external_id),
      peer_snapshot_ids: peers.map((peer) => peer.snapshot_id),
      cohort_rule: semanticPack.peer_rule,
      peer_count: peers.length,
      median_price_per_sqm: reason || !median ? null : median.toFixed(6),
      price_gap_pct:
        reason || !median || !targetPrice
          ? null
          : targetPrice.minus(median).div(median).mul(100).toFixed(6),
      abstention_reason: reason,
    };
  });
}
