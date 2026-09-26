import type { NarrativeProvider } from '../legacy-workflow/narrative/provider';
import type { ReviewerCorrectionRequest, ReviewerProvider } from './agents/reviewer-agent';

export type AgentWorkflowOptions = {
  signal?: AbortSignal;
  narrativeProvider?: NarrativeProvider;
  reviewerProvider?: ReviewerProvider;
  /** Internal deterministic test/server hook for the first review only. */
  firstReviewCorrection?: ReviewerCorrectionRequest | null;
  /** Internal deterministic test/server hook for the bounded second review. */
  secondReviewCorrection?: ReviewerCorrectionRequest | null;
};
