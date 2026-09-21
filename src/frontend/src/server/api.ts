import { z } from 'zod';
import { cookies } from 'next/headers';
import {
  AcceptedSchema,
  AnalysisRequestSchema,
  AgentTurnAcceptedSchema,
  AgentTurnRequestSchema,
  ArtifactListSchema,
  CatalogSchema,
  ConversationPageSchema,
  ConversationSchema,
  DecisionBriefResponseSchema,
  ExportRequestSchema,
  ExportResponseSchema,
  IdSchema,
  ImportManifestSchema,
  ImportRequestSchema,
  LoginSchema,
  MessageSchema,
  MessagePageSchema,
  PageRequestSchema,
  ProblemSchema,
  ReportDefinitionInputSchema,
  ReportDefinitionSchema,
  ReportDetailSchema,
  ReportRecordSchema,
  RunDetailSchema,
  RunSchema,
  RoleSchema,
  SessionSchema,
  SetupSchema,
  TimestampSchema,
} from '@vda/contracts';
import { RepositoryError } from '@vda/db';
import { getConfig } from '@vda/config';
import { AgentChatOrchestrator, exportReport } from '@vda/agents';
import {
  DEVELOPMENT_ROLE_COOKIE,
  developmentPrincipal,
  principal,
  readGrant,
  repository,
  signGrant,
  supabaseClient,
} from './context';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function json<T>(schema: z.ZodType<T>, value: unknown, status = 200) {
  return Response.json(schema.parse(value), { status, headers: noStore });
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new RepositoryError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('content-length') ?? 0) > 2_100_000)
    throw new RepositoryError('BODY_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RepositoryError('JSON_REQUIRED', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 2_100_000) {
      await reader.cancel();
      throw new RepositoryError('BODY_TOO_LARGE', 413);
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RepositoryError('INVALID_JSON', 400);
  }
}
const OrgBody = z.object({ org_id: IdSchema }).strict();
const TriggerBody = z
  .object({ org_id: IdSchema, scheduled_for: TimestampSchema.optional() })
  .strict();
const TickBody = z.object({ org_id: IdSchema, now: TimestampSchema.optional() }).strict();
const DevelopmentRoleBody = z.object({ role: RoleSchema }).strict();
const OkSchema = z.object({ ok: z.literal(true) });
type DownloadGrant = {
  user_id: string;
  org_id: string;
  report_id: string;
  format: 'json' | 'csv';
  expires: number;
};

async function handle(request: Request, path: string[]): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);
  const route = path.join('/');
  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new RepositoryError('ORIGIN_DENIED', 403);
      }
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.host !== (request.headers.get('host') ?? url.host)
      )
        throw new RepositoryError('ORIGIN_DENIED', 403);
    }
  }
  if (route === 'setup' && method === 'GET') {
    try {
      const config = getConfig();
      return json(SetupSchema, {
        mode: 'supabase',
        llm_primary_provider: config.LLM_PRIMARY_PROVIDER,
        llm_fallback_provider: config.LLM_FALLBACK_PROVIDER,
        development_role_bypass: config.DEVELOPMENT_ROLE_BYPASS,
        ready: true,
        message: config.DEVELOPMENT_ROLE_BYPASS
          ? 'Chế độ development: chọn vai trò để vào workspace.'
          : 'Supabase Auth, PostgreSQL và workspace isolation đã được cấu hình.',
      });
    } catch {
      return json(SetupSchema, {
        mode: 'supabase',
        llm_primary_provider: process.env.LLM_PRIMARY_PROVIDER === 'openai' ? 'openai' : 'gemini',
        llm_fallback_provider: process.env.LLM_FALLBACK_PROVIDER === 'gemini' ? 'gemini' : 'openai',
        development_role_bypass: false,
        ready: false,
        message: 'Thiếu cấu hình Supabase. Xem docs/LOCAL_CONFIGURATION.md.',
      });
    }
  }
  if (route === 'auth/login' && method === 'POST') {
    if (getConfig().DEVELOPMENT_ROLE_BYPASS)
      throw new RepositoryError('DEVELOPMENT_ROLE_BYPASS_ACTIVE', 409);
    const input = LoginSchema.parse(await body(request));
    const client = await supabaseClient();
    const { data, error } = await client.auth.signInWithPassword(input);
    if (error || !data.user || !data.user.email) throw new RepositoryError('LOGIN_FAILED', 401);
    return json(SessionSchema, await (await repository()).session(data.user.id, data.user.email));
  }
  if (route === 'auth/development-role' && method === 'POST') {
    const config = getConfig();
    if (!config.DEVELOPMENT_ROLE_BYPASS)
      throw new RepositoryError('DEVELOPMENT_ROLE_BYPASS_DISABLED', 404);
    const input = DevelopmentRoleBody.parse(await body(request));
    const expires = Date.now() + 8 * 60 * 60_000;
    (await cookies()).set(DEVELOPMENT_ROLE_COOKIE, signGrant({ role: input.role, expires }), {
      httpOnly: true,
      maxAge: 8 * 60 * 60,
      path: '/',
      sameSite: 'strict',
      secure: new URL(request.url).protocol === 'https:',
    });
    const actor = developmentPrincipal(input.role);
    return json(SessionSchema, await (await repository()).session(actor.user_id, actor.email));
  }
  if (route === 'auth/logout' && method === 'POST') {
    (await cookies()).set(DEVELOPMENT_ROLE_COOKIE, '', { maxAge: 0, path: '/' });
    if (!getConfig().DEVELOPMENT_ROLE_BYPASS) await (await supabaseClient()).auth.signOut();
    return json(OkSchema, { ok: true });
  }
  const actor = await principal();
  const repo = await repository();
  if (route === 'session' && method === 'GET')
    return json(SessionSchema, await repo.session(actor.user_id, actor.email));
  const orgFromQuery = () => IdSchema.parse(url.searchParams.get('org_id'));
  const pageFromQuery = () =>
    PageRequestSchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? null,
    });
  if (route === 'catalog' && method === 'GET')
    return json(CatalogSchema, await repo.catalog(actor.user_id, orgFromQuery()));
  if (route === 'analyses' && method === 'POST') {
    const input = AnalysisRequestSchema.parse(await body(request));
    const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
    const run = await repo.createRun(actor.user_id, input, key);
    return json(
      AcceptedSchema,
      { run_id: run.run_id, conversation_id: run.request.conversation_id, status: run.status },
      202,
    );
  }
  if (route === 'runs' && method === 'GET')
    return json(z.object({ runs: z.array(RunSchema) }), {
      runs: await repo.listRuns(actor.user_id, orgFromQuery()),
    });
  if (path[0] === 'runs' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'GET')
      return json(RunDetailSchema, await repo.getRun(actor.user_id, orgFromQuery(), id));
    if (path[2] === 'artifacts' && method === 'GET')
      return json(ArtifactListSchema, await repo.artifacts(actor.user_id, orgFromQuery(), id));
    if (path[2] === 'brief' && method === 'GET')
      return json(
        DecisionBriefResponseSchema,
        await repo.decisionBrief(actor.user_id, orgFromQuery(), id),
      );
    if (path[2] === 'cancel' && method === 'POST') {
      const input = OrgBody.parse(await body(request));
      await repo.cancelRun(actor.user_id, input.org_id, id);
      return json(OkSchema, { ok: true });
    }
  }
  if (route === 'messages' && method === 'GET')
    return json(z.object({ messages: z.array(MessageSchema) }), {
      messages: await repo.messages(
        actor.user_id,
        orgFromQuery(),
        IdSchema.parse(url.searchParams.get('conversation_id')),
      ),
    });
  if (route === 'conversations') {
    if (method === 'GET')
      return json(
        ConversationPageSchema,
        await repo.listConversations(actor.user_id, orgFromQuery(), pageFromQuery()),
      );
    if (method === 'POST') {
      const input = AgentTurnRequestSchema.parse(await body(request));
      const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
      return json(
        AgentTurnAcceptedSchema,
        await new AgentChatOrchestrator(repo).submit(actor.user_id, input, key),
        202,
      );
    }
  }
  if (path[0] === 'conversations' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'GET')
      return json(
        ConversationSchema,
        await repo.getConversation(actor.user_id, orgFromQuery(), id),
      );
    if (path[2] === 'messages') {
      if (method === 'GET')
        return json(
          MessagePageSchema,
          await repo.listMessages(actor.user_id, orgFromQuery(), id, pageFromQuery()),
        );
      if (method === 'POST') {
        const input = AgentTurnRequestSchema.parse(await body(request));
        const key = z.string().min(1).max(200).parse(request.headers.get('idempotency-key'));
        return json(
          AgentTurnAcceptedSchema,
          await new AgentChatOrchestrator(repo).submit(actor.user_id, input, key, id),
          202,
        );
      }
    }
  }
  if (route === 'imports') {
    if (method === 'GET')
      return json(z.object({ imports: z.array(ImportManifestSchema) }), {
        imports: await repo.listImports(actor.user_id, orgFromQuery()),
      });
    if (method === 'POST')
      return json(
        z.object({ manifest: ImportManifestSchema }),
        {
          manifest: await repo.importCsv(
            actor.user_id,
            ImportRequestSchema.parse(await body(request)),
          ),
        },
        201,
      );
  }
  if (route === 'report-definitions') {
    if (method === 'GET')
      return json(z.object({ definitions: z.array(ReportDefinitionSchema) }), {
        definitions: await repo.listDefinitions(actor.user_id, orgFromQuery()),
      });
    if (method === 'POST')
      return json(
        ReportDefinitionSchema,
        await repo.createDefinition(
          actor.user_id,
          ReportDefinitionInputSchema.parse(await body(request)),
        ),
        201,
      );
  }
  if (path[0] === 'report-definitions' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'PATCH') {
      const input = ReportDefinitionInputSchema.parse(await body(request));
      return json(
        ReportDefinitionSchema,
        await repo.updateDefinition(actor.user_id, input.org_id, id, input),
      );
    }
    if (path.length === 2 && method === 'DELETE') {
      await repo.deleteDefinition(actor.user_id, orgFromQuery(), id);
      return json(OkSchema, { ok: true });
    }
    if (path[2] === 'trigger' && method === 'POST') {
      const input = TriggerBody.parse(await body(request));
      const occurrence = await repo.triggerDefinition(
        actor.user_id,
        input.org_id,
        id,
        input.scheduled_for ? new Date(input.scheduled_for) : undefined,
      );
      const { run } = await repo.getRun(actor.user_id, input.org_id, occurrence.run_id);
      return json(
        AcceptedSchema,
        { run_id: run.run_id, conversation_id: run.request.conversation_id, status: run.status },
        202,
      );
    }
  }
  if (route === 'scheduler/tick' && method === 'POST') {
    const input = TickBody.parse(await body(request));
    const occurrences = await repo.tick(input.now ? new Date(input.now) : undefined, {
      userId: actor.user_id,
      orgId: input.org_id,
    });
    return json(z.object({ enqueued: z.number().int().nonnegative() }), {
      enqueued: occurrences.length,
    });
  }
  if (route === 'reports' && method === 'GET')
    return json(z.object({ reports: z.array(ReportRecordSchema) }), {
      reports: await repo.listReports(actor.user_id, orgFromQuery()),
    });
  if (path[0] === 'reports' && path[1]) {
    const id = IdSchema.parse(path[1]);
    if (path.length === 2 && method === 'GET')
      return json(ReportDetailSchema, await repo.getReport(actor.user_id, orgFromQuery(), id));
    if (path[2] === 'exports' && method === 'POST') {
      const input = ExportRequestSchema.parse(await body(request));
      const orgId = orgFromQuery();
      const { artifact } = await repo.getReport(actor.user_id, orgId, id);
      if (artifact.kind !== 'report') throw new RepositoryError('INVALID_REPORT', 409);
      const exported = exportReport(artifact, input.format);
      await repo.storeReportExport(
        actor.user_id,
        orgId,
        id,
        input.format,
        artifact.content_hash,
        exported.body,
        exported.contentType,
      );
      const expires = Date.now() + 5 * 60_000;
      const token = signGrant({
        user_id: actor.user_id,
        org_id: orgId,
        report_id: id,
        format: input.format,
        expires,
      });
      return json(ExportResponseSchema, {
        url: `/api/v1/reports/${id}/download?token=${encodeURIComponent(token)}`,
        expires_at: new Date(expires).toISOString(),
      });
    }
    if (path[2] === 'download' && method === 'GET') {
      const grant = readGrant<DownloadGrant>(
        z.string().max(2000).parse(url.searchParams.get('token')),
      );
      if (
        grant.user_id !== actor.user_id ||
        grant.report_id !== id ||
        !['json', 'csv'].includes(grant.format)
      )
        throw new RepositoryError('DOWNLOAD_DENIED', 403);
      const { artifact } = await repo.getReport(actor.user_id, grant.org_id, id);
      if (artifact.kind !== 'report') throw new RepositoryError('INVALID_REPORT', 409);
      const exported = exportReport(artifact, grant.format);
      return new Response(exported.body, {
        headers: {
          ...noStore,
          'Content-Type': exported.contentType,
          'Content-Disposition': `attachment; filename="vda-report-${id}.${grant.format}"`,
        },
      });
    }
  }
  throw new RepositoryError('NOT_FOUND', 404);
}
export async function api(request: Request, path: string[]) {
  try {
    return await handle(request, path);
  } catch (error) {
    if (
      error instanceof Error &&
      /^(CSV_|HIERARCHY_CONFLICT|DUPLICATE_SNAPSHOT|SCHEDULE_TIME_ABSENT)/.test(error.message)
    ) {
      const code = error.message.split(':')[0];
      return json(
        ProblemSchema,
        { type: `urn:vda:problem:${code.toLowerCase()}`, title: code, status: 422, detail: code },
        422,
      );
    }
    const status =
      error instanceof RepositoryError ? error.status : error instanceof z.ZodError ? 400 : 500;
    const code =
      error instanceof RepositoryError
        ? error.code
        : error instanceof z.ZodError
          ? 'VALIDATION_FAILED'
          : 'INTERNAL_ERROR';
    const detail =
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : status === 500
          ? 'Không thể hoàn tất yêu cầu. Kiểm tra cấu hình và thử lại.'
          : code;
    return json(
      ProblemSchema,
      { type: `urn:vda:problem:${code.toLowerCase()}`, title: code, status, detail },
      status,
    );
  }
}
