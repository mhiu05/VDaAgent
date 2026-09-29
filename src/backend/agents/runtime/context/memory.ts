import type { MemoryEntry } from '@vda/contracts';
import type { Repository } from '@vda/db';
import { estimateContextTokens } from './budget';

/** Small metadata/text retrieval with bounded records; no vector service required. */
export class MemoryRetriever {
  constructor(private readonly repository: Repository) {}

  async retrieve(input: {
    userId: string; orgId: string; conversationId: string; runId?: string; task: string;
    maxTokens?: number;
  }) {
    const candidates = await this.repository.listMemory(input.userId, input.orgId, {
      conversation_id: input.conversationId,
      ...(input.runId ? { run_id: input.runId } : {}),
      limit: 24,
    });
    const terms = [...new Set(input.task.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
    const score = (entry: MemoryEntry) => {
      const content = `${entry.key} ${entry.summary}`.toLocaleLowerCase();
      return terms.reduce((total, term) => total + (content.includes(term) ? 2 : 0), 0)
        + (entry.layer === 'working' && entry.run_id === input.runId ? 6 : 0)
        + (entry.conversation_id === input.conversationId ? 1 : 0);
    };
    const ranked = candidates
      .filter((entry) => entry.layer !== 'working' || entry.run_id === input.runId)
      .sort((left, right) => score(right) - score(left) || right.updated_at.localeCompare(left.updated_at));
    const selected: MemoryEntry[] = [];
    let remaining = input.maxTokens ?? 1_600;
    // Retain each layer before filling by relevance, so busy runs do not evict schema knowledge.
    const representatives = (['working', 'episodic', 'workspace'] as const)
      .flatMap((layer) => ranked.find((entry) => entry.layer === layer) ?? []);
    const ordered = [...representatives, ...ranked.filter((entry) => !representatives.includes(entry))];
    for (const entry of ordered) {
      if (selected.length >= 8) break;
      const size = estimateContextTokens(entry);
      if (size > remaining) continue;
      selected.push(entry);
      remaining -= size;
    }
    return {
      working: selected.filter((entry) => entry.layer === 'working'),
      episodic: selected.filter((entry) => entry.layer === 'episodic'),
      workspace: selected.filter((entry) => entry.layer === 'workspace'),
    };
  }
}
