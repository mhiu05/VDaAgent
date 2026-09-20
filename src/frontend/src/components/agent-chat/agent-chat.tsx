'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { ArtifactListSchema, RunDetailSchema, type Catalog, type Message } from '@vda/contracts';
import {
  api,
  createTurnIdentity,
  errorMessage,
  listConversationMessages,
  listConversations,
  post,
  scoped,
  sendTurn,
  type TurnRequestIdentity,
} from '../../lib/client-api';
import { AnalysisResult } from '../analysis-result';
import { EvidenceDrawer } from '../evidence';
import { Composer } from './composer';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { RunProgress } from './run-progress';

type RunDetail = z.infer<typeof RunDetailSchema>;
type ArtifactList = z.infer<typeof ArtifactListSchema>;
type RetryTurn = {
  input: {
    text: string;
    scope: { project_external_id: string; zone_external_id: string | null };
    data_as_of: string;
  };
  identity: TurnRequestIdentity;
  conversationId?: string;
};

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled']);

export function AgentChat({
  orgId,
  catalog,
  canWrite,
  externalRunId,
  onClearExternalRun,
  onReport,
}: {
  orgId: string;
  catalog: Catalog;
  canWrite: boolean;
  externalRunId?: string | null;
  onClearExternalRun?: () => void;
  onReport?: (reportId: string) => void;
}) {
  const [conversations, setConversations] = useState<
    Awaited<ReturnType<typeof listConversations>>['conversations']
  >([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [project, setProject] = useState(catalog.projects[0]?.project_external_id ?? '');
  const [zone, setZone] = useState('');
  const [dataAsOf, setDataAsOf] = useState(catalog.latest_snapshot_date ?? '');
  const [draft, setDraft] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [bundle, setBundle] = useState<ArtifactList>({
    artifacts: [],
    validations: [],
    sources: [],
  });
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryTurn, setRetryTurn] = useState<RetryTurn | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setProject((value) =>
      catalog.projects.some((item) => item.project_external_id === value)
        ? value
        : (catalog.projects[0]?.project_external_id ?? ''),
    );
    setDataAsOf((value) => value || catalog.latest_snapshot_date || '');
  }, [catalog]);

  const loadConversations = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoadingConversations(true);
      try {
        const page = await listConversations(orgId, { limit: 30, cursor });
        setConversations((current) =>
          append ? [...current, ...page.conversations] : page.conversations,
        );
        setConversationCursor(page.next_cursor);
        return page;
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoadingConversations(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    setSelectedConversationId(null);
    setMessages([]);
    setRunId(null);
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setError('');
    void loadConversations(null, false).then((page) => {
      if (page?.conversations[0]) setSelectedConversationId(page.conversations[0].conversation_id);
    });
  }, [loadConversations, orgId]);

  const loadMessages = useCallback(
    async (conversationId: string, cursor: string | null, appendEarlier: boolean) => {
      setLoadingMessages(true);
      try {
        const page = await listConversationMessages(orgId, conversationId, { limit: 30, cursor });
        setMessages((current) => (appendEarlier ? [...page.messages, ...current] : page.messages));
        setMessageCursor(page.next_cursor);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoadingMessages(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    if (!selectedConversationId) return;
    let obsolete = false;
    setMessages([]);
    setMessageCursor(null);
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    void listConversationMessages(orgId, selectedConversationId, { limit: 30 }).then(
      (page) => {
        if (obsolete) return;
        setMessages(page.messages);
        setMessageCursor(page.next_cursor);
      },
      (cause: unknown) => {
        if (!obsolete) setError(errorMessage(cause));
      },
    );
    return () => {
      obsolete = true;
    };
  }, [orgId, selectedConversationId]);

  useEffect(() => {
    if (externalRunId) {
      setRunId(externalRunId);
      return;
    }
    const latest = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.run_id !== null);
    if (latest) setRunId(latest.run_id);
  }, [externalRunId, messages]);

  const visibleRunId = externalRunId ?? runId;
  useEffect(() => {
    if (!visibleRunId) return;
    let obsolete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const detail = await api(scoped(`/runs/${visibleRunId}`, orgId), RunDetailSchema);
        if (obsolete) return;
        setRunDetail(detail);
        if (terminalStatuses.has(detail.run.status)) {
          const artifacts = await api(
            scoped(`/runs/${visibleRunId}/artifacts`, orgId),
            ArtifactListSchema,
          );
          if (!obsolete) {
            setBundle(artifacts);
            void loadConversations(null, false);
            if (selectedConversationId) void loadMessages(selectedConversationId, null, false);
          }
        } else if (!document.hidden && !obsolete) timer = setTimeout(() => void poll(), 1_100);
        else if (!obsolete) timer = setTimeout(() => void poll(), 5_000);
      } catch (cause) {
        if (!obsolete) setError(errorMessage(cause));
      }
    }
    void poll();
    return () => {
      obsolete = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadConversations, loadMessages, orgId, selectedConversationId, visibleRunId]);

  const selectedArtifact = useMemo(
    () => bundle.artifacts.find((artifact) => artifact.artifact_id === evidenceId),
    [bundle.artifacts, evidenceId],
  );
  const reportId = useMemo(() => {
    for (const message of [...messages].reverse())
      for (const part of message.parts) if (part.type === 'report_ref') return part.report_id;
    return null;
  }, [messages]);

  function selectConversation(id: string) {
    onClearExternalRun?.();
    setSelectedConversationId(id);
    setRunId(null);
    setEvidenceId(null);
    setError('');
  }
  function newConversation() {
    onClearExternalRun?.();
    setSelectedConversationId(null);
    setMessages([]);
    setMessageCursor(null);
    setRunId(null);
    setRunDetail(null);
    setBundle({ artifacts: [], validations: [], sources: [] });
    setEvidenceId(null);
    setDraft('');
    setRetryTurn(null);
    setError('');
  }
  async function submit() {
    const attempt = retryTurn ?? {
      input: {
        text: draft.trim(),
        scope: { project_external_id: project, zone_external_id: zone || null },
        data_as_of: dataAsOf,
      },
      identity: createTurnIdentity(),
      conversationId: selectedConversationId ?? undefined,
    };
    if (!attempt.input.text || busy) return;
    setBusy(true);
    setError('');
    try {
      const accepted = await sendTurn(
        orgId,
        attempt.input,
        attempt.identity,
        attempt.conversationId,
      );
      setRetryTurn(null);
      setDraft('');
      setSelectedConversationId(accepted.conversation_id);
      setRunId(accepted.run_id);
      setRunDetail(null);
      setBundle({ artifacts: [], validations: [], sources: [] });
      await loadConversations(null, false);
      await loadMessages(accepted.conversation_id, null, false);
    } catch (cause) {
      setRetryTurn(attempt);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function cancelRun() {
    if (!visibleRunId) return;
    setCancelling(true);
    try {
      await api(
        scoped(`/runs/${visibleRunId}/cancel`, orgId),
        z.object({ ok: z.literal(true) }),
        post({ org_id: orgId }),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="agent-chat-layout">
      <ConversationList
        conversations={conversations}
        selectedId={selectedConversationId}
        loading={loadingConversations}
        hasMore={conversationCursor !== null}
        onNew={newConversation}
        onSelect={selectConversation}
        onLoadMore={() => conversationCursor && void loadConversations(conversationCursor, true)}
      />
      <div className="agent-chat-main">
        {error && (
          <div className="error-box" role="alert">
            <CircleAlert size={18} />
            <div>{error}</div>
            {retryTurn ? (
              <button className="text-button" disabled={busy} onClick={() => void submit()}>
                <RefreshCw size={13} /> Thử lại
              </button>
            ) : (
              <button className="text-button" onClick={() => setError('')}>
                Đóng
              </button>
            )}
          </div>
        )}
        {runDetail && (
          <RunProgress
            detail={runDetail}
            canWrite={canWrite}
            cancelling={cancelling}
            onCancel={() => void cancelRun()}
          />
        )}
        <MessageThread
          messages={messages}
          loading={loadingMessages}
          hasEarlier={messageCursor !== null}
          onLoadEarlier={() =>
            selectedConversationId &&
            messageCursor &&
            void loadMessages(selectedConversationId, messageCursor, true)
          }
          onOpenRun={(id) => {
            onClearExternalRun?.();
            setRunId(id);
          }}
          onOpenReport={(id) => onReport?.(id)}
        />
        {runDetail?.run.status === 'succeeded' && (
          <AnalysisResult
            artifacts={bundle.artifacts}
            onEvidence={setEvidenceId}
            onReport={reportId && onReport ? () => onReport(reportId) : undefined}
          />
        )}
        <Composer
          catalog={catalog}
          canWrite={canWrite}
          project={project}
          zone={zone}
          dataAsOf={dataAsOf}
          draft={draft}
          busy={busy}
          onProject={setProject}
          onZone={setZone}
          onDate={setDataAsOf}
          onDraft={setDraft}
          onSubmit={() => void submit()}
        />
      </div>
      {selectedArtifact && (
        <EvidenceDrawer
          artifact={selectedArtifact}
          artifacts={bundle.artifacts}
          validations={bundle.validations}
          sources={bundle.sources}
          onSelect={setEvidenceId}
          onClose={() => setEvidenceId(null)}
        />
      )}
    </div>
  );
}
