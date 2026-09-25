import { randomUUID } from 'node:crypto';
import {
  ReportDefinitionInputSchema,
  type AnalysisRequest,
  type AnalysisRun,
  type ReportDefinition,
  type ReportDefinitionInput,
  type ReportOccurrence,
} from '@vda/contracts';
import { localDate, nextScheduledAt, scheduledOnDate } from '@vda/domain';
import { authorizeInTransaction } from '../authorization/authorization-repository';
import type { Driver } from '../driver';
import { fail } from '../errors';
import { json } from '../mapping/rows';

const now = () => new Date().toISOString();

export class ScheduleRepository {
  constructor(
    private readonly db: Driver,
    private readonly buildRun: (
      tx: Driver,
      user: string,
      input: AnalysisRequest,
      key: string,
      options: { entrypoint?: 'interactive' | 'scheduled'; occurrence_id?: string },
    ) => Promise<AnalysisRun>,
  ) {}

  private auth(tx: Driver, user: string, org: string, write = false) {
    return authorizeInTransaction(tx, user, org, write);
  }

  async deleteDefinition(user: string, org: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const def = await this.definition(tx, org, id);
      def.enabled = false;
      def.definition_version++;
      await this.saveDefinition(tx, def);
    });
  }

  async createDefinition(user: string, input: ReportDefinitionInput, date = new Date()) {
    return this.db.transaction(async (tx) => {
      const parsed = ReportDefinitionInputSchema.parse(input);
      await this.auth(tx, user, parsed.org_id, true);
      const def: ReportDefinition = {
        ...parsed,
        report_definition_id: randomUUID(),
        definition_version: 1,
        created_by: user,
        created_at: now(),
        next_run_at: nextScheduledAt(parsed, date),
      };
      await tx.query(
        'INSERT INTO definitions(org_id,id,created_by,next_run_at,enabled,payload) VALUES($1,$2,$3,$4,$5,$6)',
        [
          def.org_id,
          def.report_definition_id,
          user,
          def.next_run_at,
          Number(def.enabled),
          JSON.stringify(def),
        ],
      );
      return def;
    });
  }

  async updateDefinition(
    user: string,
    org: string,
    id: string,
    input: ReportDefinitionInput,
    date = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const old = await this.definition(tx, org, id);
      const parsed = ReportDefinitionInputSchema.parse(input);
      if (parsed.org_id !== org) fail('DEFINITION_SCOPE_MISMATCH', 403);
      const def = {
        ...old,
        ...parsed,
        definition_version: old.definition_version + 1,
        next_run_at: nextScheduledAt(parsed, date),
      };
      await this.saveDefinition(tx, def);
      return def;
    });
  }

  async listDefinitions(user: string, org: string): Promise<ReportDefinition[]> {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org);
      const rows = await tx.query('SELECT payload FROM definitions WHERE org_id=$1', [org]);
      return rows.map(json) as ReportDefinition[];
    });
  }

  private async definition(tx: Driver, org: string, id: string): Promise<ReportDefinition> {
    const rows = await tx.query(
      'SELECT payload FROM definitions WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [org, id],
    );
    if (!rows[0]) fail('DEFINITION_NOT_FOUND', 404);
    return json(rows[0]) as ReportDefinition;
  }

  private async saveDefinition(tx: Driver, def: ReportDefinition) {
    await tx.query(
      'UPDATE definitions SET next_run_at=$1,enabled=$2,payload=$3 WHERE org_id=$4 AND id=$5',
      [
        def.next_run_at,
        Number(def.enabled),
        JSON.stringify(def),
        def.org_id,
        def.report_definition_id,
      ],
    );
  }

  private async occurrence(
    tx: Driver,
    def: ReportDefinition,
    scheduled: string,
  ): Promise<ReportOccurrence> {
    await this.auth(tx, def.created_by, def.org_id, true);
    const existing = await tx.query(
      'SELECT payload FROM occurrences WHERE org_id=$1 AND definition_id=$2 AND scheduled_for=$3',
      [def.org_id, def.report_definition_id, scheduled],
    );
    if (existing[0]) return json(existing[0]) as ReportOccurrence;
    let asOf = localDate(new Date(scheduled), def.timezone);
    if (def.data_as_of_policy === 'previous_day')
      asOf = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
    const id = randomUUID();
    const run = await this.buildRun(
      tx,
      def.created_by,
      {
        org_id: def.org_id,
        scope: def.scope,
        data_as_of: asOf,
        question: `Báo cáo hằng ngày: ${def.name}`,
        conversation_id: null,
      },
      `schedule:${def.report_definition_id}:${scheduled}`,
      { entrypoint: 'scheduled', occurrence_id: id },
    );
    const occurrence: ReportOccurrence = {
      occurrence_id: id,
      org_id: def.org_id,
      report_definition_id: def.report_definition_id,
      definition_version: def.definition_version,
      definition_snapshot: def,
      scheduled_for: scheduled,
      run_id: run.run_id,
      created_at: now(),
    };
    await tx.query(
      'INSERT INTO occurrences(org_id,id,definition_id,scheduled_for,run_id,payload) VALUES($1,$2,$3,$4,$5,$6)',
      [def.org_id, id, def.report_definition_id, scheduled, run.run_id, JSON.stringify(occurrence)],
    );
    return occurrence;
  }

  async triggerDefinition(user: string, org: string, id: string, date = new Date()) {
    return this.db.transaction(async (tx) => {
      await this.auth(tx, user, org, true);
      const def = await this.definition(tx, org, id);
      const day = localDate(date, def.timezone);
      const scheduled = scheduledOnDate(def, day);
      return this.occurrence(tx, def, scheduled);
    });
  }

  async tick(
    date = new Date(),
    scope?: { userId: string; orgId: string },
  ): Promise<ReportOccurrence[]> {
    return this.db.transaction(async (tx) => {
      if (scope) await this.auth(tx, scope.userId, scope.orgId, true);
      const rows = await tx.query(
        `SELECT payload FROM definitions WHERE enabled=1 AND next_run_at<=$1${scope ? ' AND org_id=$2' : ''} FOR UPDATE SKIP LOCKED`,
        scope ? [date.toISOString(), scope.orgId] : [date.toISOString()],
      );
      const result: ReportOccurrence[] = [];
      for (const row of rows) {
        const def = json(row) as ReportDefinition;
        try {
          await this.auth(tx, def.created_by, def.org_id, true);
        } catch {
          def.enabled = false;
          await this.saveDefinition(tx, def);
          continue;
        }
        result.push(await this.occurrence(tx, def, def.next_run_at));
        def.next_run_at = nextScheduledAt(def, date);
        await this.saveDefinition(tx, def);
      }
      return result;
    });
  }
}
