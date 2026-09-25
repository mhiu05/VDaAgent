import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  AgentDecisionSchema,
  type AgentDecision,
  type Role,
  type Scope,
  type SignalRef,
} from '@vda/contracts';
import { getConfig, type AppConfig, type LlmProvider } from '@vda/config';
import { GeminiResponseSchema } from '../../providers/gemini-response';

export type AgentDecisionContext = {
  question: string;
  scope: Scope;
  data_as_of: string;
  scope_changed: boolean;
  date_changed: boolean;
  role: Role;
  catalog: {
    projects: Array<{
      project_external_id: string;
      zones: Array<{ zone_external_id: string; zone_name: string }>;
    }>;
    latest_snapshot_date: string | null;
  };
  recent_messages: { role: 'user' | 'assistant'; content: string }[];
  allowed_run_ids: string[];
  active_brief: {
    run_id: string;
    scope: Scope;
    requested_data_as_of: string;
    effective_snapshot_date: string | null;
    signals: Array<{
      signal_id: string;
      kind: 'current_state' | 'material_change' | 'segment_concentration' | 'data_quality';
      dimension: 'zone' | 'unit_type' | 'bedrooms' | 'status' | null;
      segment_key: string | null;
      supported_action: 'inspect_signal';
      supported_next_action_ids: string[];
    }>;
  } | null;
  /** Compact canonical decision metadata; it never grants the provider calculation authority. */
  active_decision?: {
    run_id: string;
    scope: Scope;
    requested_data_as_of: string;
    effective_snapshot_date: string | null;
    status: 'improving' | 'stable' | 'deteriorating' | 'mixed' | 'insufficient_evidence';
    priority_entities: Array<{
      priority_entity_id: string;
      label: string;
      rank: number;
      tier: 'critical' | 'high' | 'medium' | 'watch';
      support_level: 'high' | 'medium' | 'limited';
      limitations: string[];
    }>;
    action_candidates: Array<{
      action_candidate_id: string;
      label: string;
      support_level: 'high' | 'medium' | 'exploratory';
      drilldown_id: string;
      limitations: string[];
    }>;
    drilldown_ids: string[];
    limitations: string[];
  } | null;
  requested_signal_ref: SignalRef | null;
};

export interface AgentDecisionProvider {
  decide(context: AgentDecisionContext): Promise<AgentDecision>;
}

const decisionInstructions =
  'Choose exactly one action for a VDa inventory request. Supported actions are create_analysis, get_analysis_result, inspect_signal, or unsupported. active_decision contains validated component IDs, labels, support and limitations only; it is context, not authority to calculate values, rank entities, or invent actions. Never calculate a metric, create a factual answer, SQL, an ID, a scope, a permission, or an action outside the supplied schema. create_analysis must use only a supplied focus enum; it may select scope_ref only from catalog.projects and their zones. get_analysis_result may use only a run_id from allowed_run_ids. inspect_signal may use only a run_id and signal_id listed in active_brief.signals. If scope_changed or date_changed is true, create_analysis is required. A request for causality must be unsupported. Return JSON only.';

export class GeminiAgentDecisionProvider implements AgentDecisionProvider {
  readonly provider = 'gemini' as const;
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async decide(context: AgentDecisionContext): Promise<AgentDecision> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: decisionInstructions }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(context) }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseJsonSchema: {
                type: 'object',
                properties: {
                  action: {
                    type: 'string',
                    enum: [
                      'create_analysis',
                      'get_analysis_result',
                      'inspect_signal',
                      'unsupported',
                    ],
                  },
                  focus: { type: 'string' },
                  run_id: { type: 'string' },
                  signal_id: { type: 'string' },
                  scope_ref: {
                    type: 'object',
                    properties: {
                      project_external_id: { type: 'string' },
                      zone_external_id: { type: ['string', 'null'] },
                    },
                    required: ['project_external_id', 'zone_external_id'],
                    additionalProperties: false,
                  },
                  reason_code: { type: 'string' },
                },
                required: ['action'],
                additionalProperties: false,
              },
              temperature: 0,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new Error('GEMINI_AGENT_REQUEST_FAILED');
    }
    if (!response.ok) throw new Error('GEMINI_AGENT_REQUEST_FAILED');
    try {
      const body: unknown = await response.json();
      const text = GeminiResponseSchema.parse(body)
        .candidates.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text)
        .find((part): part is string => Boolean(part));
      if (!text) throw new Error('missing Gemini response text');
      return AgentDecisionSchema.parse(JSON.parse(text));
    } catch {
      throw new Error('GEMINI_AGENT_RESPONSE_INVALID');
    }
  }
}

export class OpenAIAgentDecisionProvider implements AgentDecisionProvider {
  readonly provider = 'openai' as const;
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}
  async decide(context: AgentDecisionContext): Promise<AgentDecision> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        instructions: decisionInstructions,
        input: JSON.stringify(context),
        text: { format: zodTextFormat(AgentDecisionSchema, 'agent_decision') },
      });
      return AgentDecisionSchema.parse(response.output_parsed);
    } catch {
      throw new Error('OPENAI_AGENT_REQUEST_FAILED');
    }
  }
}

export class FallbackAgentDecisionProvider implements AgentDecisionProvider {
  constructor(private readonly providers: readonly AgentDecisionProvider[]) {
    if (providers.length === 0) throw new Error('LLM_PROVIDER_REQUIRED');
  }
  async decide(context: AgentDecisionContext): Promise<AgentDecision> {
    for (const provider of this.providers) {
      try {
        return await provider.decide(context);
      } catch {
        // Each configured provider receives the same bounded context.
      }
    }
    throw new Error('ALL_AGENT_PROVIDERS_FAILED');
  }
}

export function createDecisionProvider(config: AppConfig = getConfig()): AgentDecisionProvider {
  const providers: Record<LlmProvider, AgentDecisionProvider> = {
    gemini: new GeminiAgentDecisionProvider(config.GEMINI_API_KEY!, config.GEMINI_MODEL!),
    openai: new OpenAIAgentDecisionProvider(
      new OpenAI({ apiKey: config.OPENAI_API_KEY!, timeout: 30_000, maxRetries: 1 }),
      config.OPENAI_MODEL!,
    ),
  };
  return new FallbackAgentDecisionProvider([
    providers[config.LLM_PRIMARY_PROVIDER],
    providers[config.LLM_FALLBACK_PROVIDER],
  ]);
}
