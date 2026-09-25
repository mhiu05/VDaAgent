import type { Catalog } from '@vda/contracts/api/responses';
import type { UnitSnapshot } from '@vda/contracts/imports/inventory';
import type { Driver } from '../driver';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import { json } from '../mapping/rows';

export function readCatalog(db: Driver, user: string, org: string): Promise<Catalog> {
  return db.transaction(async (tx) => {
    await authorizeInTransaction(tx, user, org);
    const rows = (await tx.query('SELECT payload FROM snapshots WHERE org_id=$1', [org])).map(
      json,
    ) as UnitSnapshot[];
    const projects = new Map<string, Catalog['projects'][number]>();
    for (const row of rows) {
      let p = projects.get(row.project_external_id);
      if (!p) {
        p = {
          project_external_id: row.project_external_id,
          project_name: row.project_name,
          zones: [],
        };
        projects.set(p.project_external_id, p);
      }
      if (!p.zones.some((z) => z.zone_external_id === row.zone_external_id))
        p.zones.push({ zone_external_id: row.zone_external_id, zone_name: row.zone_name });
    }
    return {
      projects: [...projects.values()],
      latest_snapshot_date:
        rows
          .map((r) => r.snapshot_date)
          .sort()
          .at(-1) ?? null,
    };
  });
}
