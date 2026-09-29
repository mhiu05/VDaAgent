import type { NarrativeProvider } from '../providers/narrative';
import type { ReviewerCorrectionRequest, ReviewerProvider } from './specialists/reviewer';

export type AgentWorkflowOptions = {
  signal?: AbortSignal;
  narrativeProvider?: NarrativeProvider;
  reviewerProvider?: ReviewerProvider;
  /** Internal deterministic test/server hook for the first review only. */
  firstReviewCorrection?: ReviewerCorrectionRequest | null;
  /** Internal deterministic test/server hook for the bounded second review. */
  secondReviewCorrection?: ReviewerCorrectionRequest | null;
};
