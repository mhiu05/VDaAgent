"""SQLite persistence for agent observability, governance, and chat history.

This repository keeps the agent domain independent from a specific ORM. Each
operation opens a short-lived connection so FastAPI worker threads can safely
share the repository without sharing SQLite connection objects.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from src.config import get_settings
from src.models.schemas import (
    AgentRun,
    AgentTraceEvent,
    ChatMessage,
    Conversation,
    HitlRecord,
    KnowledgeDocument,
    ProfilingPlan,
    ProfilingPlanItem,
    ReportComment,
    ProfileReportRecord,
    ProfileReportSummary,
    ProfileResult,
    UserRule,
    UserWorkspace,
)


class AgentRepository:
    def __init__(self, database_path: str | Path | None = None) -> None:
        self.database_path = Path(database_path or _sqlite_path_from_settings())
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self.initialize_schema()

    def initialize_schema(self) -> None:
        with self._read() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS agent_runs (
                    run_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'anonymous',
                    source_name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metrics_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS trace_events (
                    span_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    trace_id TEXT NOT NULL,
                    parent_span_id TEXT,
                    event_type TEXT NOT NULL,
                    component TEXT NOT NULL,
                    tool_name TEXT,
                    input_summary TEXT NOT NULL,
                    output_summary TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS hitl_records (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'anonymous',
                    run_id TEXT NOT NULL,
                    type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    source TEXT NOT NULL,
                    table_name TEXT,
                    columns_json TEXT NOT NULL DEFAULT '[]',
                    evidence TEXT NOT NULL,
                    proposed_action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    reviewer TEXT,
                    reviewed_at TEXT,
                    comment TEXT,
                    FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    run_id TEXT,
                    created_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS profile_reports (
                    run_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'anonymous',
                    source_name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    row_count INTEGER NOT NULL DEFAULT 0,
                    column_count INTEGER NOT NULL DEFAULT 0,
                    warning_count INTEGER NOT NULL DEFAULT 0,
                    critical_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    report_json TEXT NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS report_comments (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    author_name TEXT NOT NULL,
                    comment TEXT NOT NULL,
                    column_name TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (run_id) REFERENCES profile_reports(run_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS user_workspaces (
                    user_id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS knowledge_documents (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    extracted_text TEXT NOT NULL DEFAULT '',
                    summary TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS profiling_plans (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    source_name TEXT,
                    selected_sections_json TEXT NOT NULL DEFAULT '[]',
                    custom_requirements TEXT NOT NULL DEFAULT '',
                    items_json TEXT NOT NULL DEFAULT '[]',
                    clarification_questions_json TEXT NOT NULL DEFAULT '[]',
                    confirmed INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS user_rules (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    source_name TEXT,
                    column_name TEXT,
                    rule_type TEXT NOT NULL,
                    description TEXT NOT NULL,
                    evidence TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at
                    ON agent_runs(started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_trace_events_run_started
                    ON trace_events(run_id, started_at);
                CREATE INDEX IF NOT EXISTS idx_hitl_records_status_run
                    ON hitl_records(status, run_id);
                CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
                    ON conversations(user_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
                    ON chat_messages(conversation_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_profile_reports_created
                    ON profile_reports(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_report_comments_run_created
                    ON report_comments(run_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_knowledge_documents_user_created
                    ON knowledge_documents(user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_profiling_plans_user_created
                    ON profiling_plans(user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_user_rules_user_created
                    ON user_rules(user_id, created_at DESC);
                """
            )
            self._ensure_column(connection, "agent_runs", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'")
            self._ensure_column(connection, "hitl_records", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'")
            self._ensure_column(connection, "profile_reports", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'")
            connection.executescript(
                """
                CREATE INDEX IF NOT EXISTS idx_agent_runs_user_started
                    ON agent_runs(user_id, started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_hitl_records_user_status
                    ON hitl_records(user_id, status, run_id);
                CREATE INDEX IF NOT EXISTS idx_profile_reports_user_created
                    ON profile_reports(user_id, created_at DESC);
                """
            )

    def save_run(self, run: AgentRun) -> AgentRun:
        user_id = _metadata_user_id(run.metrics)
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO agent_runs (
                    run_id, user_id, source_name, source_type, status, started_at, updated_at, metrics_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    source_name = excluded.source_name,
                    source_type = excluded.source_type,
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    metrics_json = excluded.metrics_json
                """,
                (
                    run.run_id,
                    user_id,
                    run.source_name,
                    run.source_type,
                    run.status,
                    run.started_at,
                    run.updated_at,
                    _json(run.metrics),
                ),
            )
        return run

    def get_run(self, run_id: str) -> AgentRun | None:
        with self._read() as connection:
            row = connection.execute(
                "SELECT * FROM agent_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
        return _run_from_row(row) if row else None

    def list_runs(self, limit: int = 100, offset: int = 0, user_id: str | None = None) -> list[AgentRun]:
        query = "SELECT * FROM agent_runs"
        parameters: list[Any] = []
        if user_id:
            query += " WHERE user_id = ?"
            parameters.append(user_id)
        query += " ORDER BY started_at DESC LIMIT ? OFFSET ?"
        parameters.extend([limit, offset])
        with self._read() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [_run_from_row(row) for row in rows]

    def save_trace_event(self, event: AgentTraceEvent) -> AgentTraceEvent:
        with self._write() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO trace_events (
                    span_id, run_id, trace_id, parent_span_id, event_type, component,
                    tool_name, input_summary, output_summary, status, started_at, ended_at,
                    duration_ms, error_message, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.span_id,
                    event.run_id,
                    event.trace_id,
                    event.parent_span_id,
                    event.event_type,
                    event.component,
                    event.tool_name,
                    event.input_summary,
                    event.output_summary,
                    event.status,
                    event.started_at,
                    event.ended_at,
                    event.duration_ms,
                    event.error_message,
                    _json(event.metadata),
                ),
            )
        return event

    def list_trace_events(
        self,
        run_id: str | None = None,
        limit: int = 500,
        offset: int = 0,
    ) -> list[AgentTraceEvent]:
        query = "SELECT * FROM trace_events"
        parameters: list[Any] = []
        if run_id:
            query += " WHERE run_id = ?"
            parameters.append(run_id)
        query += " ORDER BY started_at ASC LIMIT ? OFFSET ?"
        parameters.extend([limit, offset])
        with self._read() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [_trace_from_row(row) for row in rows]

    def save_hitl_record(self, record: HitlRecord) -> HitlRecord:
        run = self.get_run(record.run_id)
        user_id = _metadata_user_id(run.metrics if run else {})
        with self._write() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO hitl_records (
                    id, user_id, run_id, type, severity, source, table_name, columns_json, evidence,
                    proposed_action, status, reviewer, reviewed_at, comment
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    user_id,
                    record.run_id,
                    record.type,
                    record.severity,
                    record.source,
                    record.table,
                    _json(record.columns),
                    record.evidence,
                    record.proposed_action,
                    record.status,
                    record.reviewer,
                    record.reviewed_at,
                    record.comment,
                ),
            )
        return record

    def get_hitl_record(self, record_id: str) -> HitlRecord | None:
        with self._read() as connection:
            row = connection.execute(
                "SELECT * FROM hitl_records WHERE id = ?", (record_id,)
            ).fetchone()
        return _hitl_from_row(row) if row else None

    def list_hitl_records(
        self,
        status: str | None = None,
        run_id: str | None = None,
        user_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[HitlRecord]:
        clauses: list[str] = []
        parameters: list[Any] = []
        if status:
            clauses.append("status = ?")
            parameters.append(status)
        if run_id:
            clauses.append("run_id = ?")
            parameters.append(run_id)
        if user_id:
            clauses.append("user_id = ?")
            parameters.append(user_id)
        query = "SELECT * FROM hitl_records"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY rowid DESC LIMIT ? OFFSET ?"
        parameters.extend([limit, offset])
        with self._read() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [_hitl_from_row(row) for row in rows]

    def save_conversation(self, conversation: Conversation) -> Conversation:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO conversations (
                    id, user_id, title, created_at, updated_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    metadata_json = excluded.metadata_json
                """,
                (
                    conversation.id,
                    conversation.user_id,
                    conversation.title,
                    conversation.created_at,
                    conversation.updated_at,
                    _json(conversation.metadata),
                ),
            )
        return conversation

    def get_conversation(self, conversation_id: str) -> Conversation | None:
        with self._read() as connection:
            row = connection.execute(
                """
                SELECT c.*, COUNT(m.id) AS message_count
                FROM conversations c
                LEFT JOIN chat_messages m ON m.conversation_id = c.id
                WHERE c.id = ?
                GROUP BY c.id
                """,
                (conversation_id,),
            ).fetchone()
        return _conversation_from_row(row) if row else None

    def list_conversations(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Conversation]:
        with self._read() as connection:
            rows = connection.execute(
                """
                SELECT c.*, COUNT(m.id) AS message_count
                FROM conversations c
                LEFT JOIN chat_messages m ON m.conversation_id = c.id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            ).fetchall()
        return [_conversation_from_row(row) for row in rows]

    def save_chat_message(self, message: ChatMessage) -> ChatMessage:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO chat_messages (
                    id, conversation_id, role, content, run_id, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id,
                    message.conversation_id,
                    message.role,
                    message.content,
                    message.run_id,
                    message.created_at,
                    _json(message.metadata),
                ),
            )
            connection.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (message.created_at, message.conversation_id),
            )
        return message

    def list_chat_messages(
        self,
        conversation_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> list[ChatMessage]:
        with self._read() as connection:
            rows = connection.execute(
                """
                SELECT * FROM (
                    SELECT * FROM chat_messages
                    WHERE conversation_id = ?
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                ) recent_messages
                ORDER BY created_at ASC
                """,
                (conversation_id, limit, offset),
            ).fetchall()
        return [_message_from_row(row) for row in rows]

    def save_profile_report(self, profile: ProfileResult, user_id: str = "anonymous") -> ProfileReportRecord | None:
        run_id = profile.agent_run.run_id if profile.agent_run else None
        if not run_id:
            return None
        created_at = profile.profile_metadata.generated_at
        summary = profile.dataset_summary
        quality = profile.quality_summary
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO profile_reports (
                    run_id, user_id, source_name, source_type, row_count, column_count,
                    warning_count, critical_count, created_at, report_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    source_name = excluded.source_name,
                    source_type = excluded.source_type,
                    row_count = excluded.row_count,
                    column_count = excluded.column_count,
                    warning_count = excluded.warning_count,
                    critical_count = excluded.critical_count,
                    created_at = excluded.created_at,
                    report_json = excluded.report_json
                """,
                (
                    run_id,
                    user_id,
                    profile.source.name,
                    profile.source.type,
                    summary.row_count,
                    summary.column_count,
                    quality.warning_count,
                    quality.critical_count,
                    created_at,
                    _json(profile.model_dump(mode="json")),
                ),
            )
        return ProfileReportRecord(
            run_id=run_id,
            user_id=user_id,
            source_name=profile.source.name,
            source_type=profile.source.type,
            row_count=summary.row_count,
            column_count=summary.column_count,
            warning_count=quality.warning_count,
            critical_count=quality.critical_count,
            created_at=created_at,
            report=profile,
        )

    def get_profile_report(self, run_id: str, user_id: str | None = None) -> ProfileReportRecord | None:
        query = "SELECT * FROM profile_reports WHERE run_id = ?"
        parameters: list[Any] = [run_id]
        if user_id:
            query += " AND user_id = ?"
            parameters.append(user_id)
        with self._read() as connection:
            row = connection.execute(query, parameters).fetchone()
        return _profile_report_from_row(row) if row else None

    def list_profile_reports(
        self,
        limit: int = 100,
        offset: int = 0,
        user_id: str | None = None,
    ) -> list[ProfileReportSummary]:
        query = """
            SELECT run_id, user_id, source_name, source_type, row_count, column_count,
                   warning_count, critical_count, created_at
            FROM profile_reports
        """
        parameters: list[Any] = []
        if user_id:
            query += " WHERE user_id = ?"
            parameters.append(user_id)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        parameters.extend([limit, offset])
        with self._read() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [_profile_report_summary_from_row(row) for row in rows]

    def add_report_comment(
        self,
        run_id: str,
        user_id: str,
        author_name: str,
        comment: str,
        column: str | None = None,
    ) -> ReportComment:
        saved = ReportComment(
            id=f"comment_{uuid4().hex}",
            run_id=run_id,
            user_id=user_id,
            author_name=author_name,
            comment=comment,
            column=column,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO report_comments (
                    id, run_id, user_id, author_name, comment, column_name, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    saved.id,
                    saved.run_id,
                    saved.user_id,
                    saved.author_name,
                    saved.comment,
                    saved.column,
                    saved.created_at,
                ),
            )
        return saved

    def list_report_comments(
        self,
        run_id: str,
        user_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ReportComment]:
        query = "SELECT * FROM report_comments WHERE run_id = ?"
        parameters: list[Any] = [run_id]
        if user_id:
            query += " AND user_id = ?"
            parameters.append(user_id)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        parameters.extend([limit, offset])
        with self._read() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [_report_comment_from_row(row) for row in rows]

    def get_or_create_user_workspace(
        self,
        user_id: str,
        display_name: str = "Analyst",
        role: str = "data_analyst",
        metadata: dict[str, object] | None = None,
    ) -> UserWorkspace:
        existing = self.get_user_workspace(user_id)
        if existing:
            return existing
        now = datetime.now(timezone.utc).isoformat()
        workspace = UserWorkspace(
            user_id=user_id,
            display_name=display_name,
            role=role,
            created_at=now,
            updated_at=now,
            metadata=metadata or {},
        )
        return self.save_user_workspace(workspace)

    def get_user_workspace(self, user_id: str) -> UserWorkspace | None:
        with self._read() as connection:
            row = connection.execute(
                "SELECT * FROM user_workspaces WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        return _user_workspace_from_row(row) if row else None

    def save_user_workspace(self, workspace: UserWorkspace) -> UserWorkspace:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO user_workspaces (
                    user_id, display_name, role, created_at, updated_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    role = excluded.role,
                    updated_at = excluded.updated_at,
                    metadata_json = excluded.metadata_json
                """,
                (
                    workspace.user_id,
                    workspace.display_name,
                    workspace.role,
                    workspace.created_at,
                    workspace.updated_at,
                    _json(workspace.metadata),
                ),
            )
        return workspace

    def save_knowledge_document(self, document: KnowledgeDocument) -> KnowledgeDocument:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO knowledge_documents (
                    id, user_id, name, content_type, size, status, extracted_text, summary, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document.id,
                    document.user_id,
                    document.name,
                    document.content_type,
                    document.size,
                    document.status,
                    document.extracted_text,
                    document.summary,
                    document.created_at,
                ),
            )
        return document

    def list_knowledge_documents(self, user_id: str, limit: int = 100, offset: int = 0) -> list[KnowledgeDocument]:
        with self._read() as connection:
            rows = connection.execute(
                """
                SELECT * FROM knowledge_documents
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            ).fetchall()
        return [_knowledge_document_from_row(row) for row in rows]

    def get_knowledge_documents(self, user_id: str, document_ids: list[str]) -> list[KnowledgeDocument]:
        if not document_ids:
            return self.list_knowledge_documents(user_id, limit=20)
        placeholders = ",".join("?" for _ in document_ids)
        with self._read() as connection:
            rows = connection.execute(
                f"SELECT * FROM knowledge_documents WHERE user_id = ? AND id IN ({placeholders})",
                [user_id, *document_ids],
            ).fetchall()
        return [_knowledge_document_from_row(row) for row in rows]

    def save_profiling_plan(self, plan: ProfilingPlan) -> ProfilingPlan:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO profiling_plans (
                    id, user_id, source_name, selected_sections_json, custom_requirements,
                    items_json, clarification_questions_json, confirmed, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    selected_sections_json = excluded.selected_sections_json,
                    items_json = excluded.items_json,
                    clarification_questions_json = excluded.clarification_questions_json,
                    confirmed = excluded.confirmed,
                    updated_at = excluded.updated_at
                """,
                (
                    plan.id,
                    plan.user_id,
                    plan.source_name,
                    _json(plan.selected_sections),
                    plan.custom_requirements,
                    _json([item.model_dump(mode="json") for item in plan.items]),
                    _json(plan.clarification_questions),
                    1 if plan.confirmed else 0,
                    plan.created_at,
                    plan.updated_at,
                ),
            )
        return plan

    def get_profiling_plan(self, plan_id: str, user_id: str | None = None) -> ProfilingPlan | None:
        query = "SELECT * FROM profiling_plans WHERE id = ?"
        parameters: list[Any] = [plan_id]
        if user_id:
            query += " AND user_id = ?"
            parameters.append(user_id)
        with self._read() as connection:
            row = connection.execute(query, parameters).fetchone()
        return _profiling_plan_from_row(row) if row else None

    def list_user_rules(self, user_id: str, limit: int = 100, offset: int = 0) -> list[UserRule]:
        with self._read() as connection:
            rows = connection.execute(
                """
                SELECT * FROM user_rules
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (user_id, limit, offset),
            ).fetchall()
        return [_user_rule_from_row(row) for row in rows]

    def save_user_rule(self, rule: UserRule) -> UserRule:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO user_rules (
                    id, user_id, source_name, column_name, rule_type, description, evidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rule.id,
                    rule.user_id,
                    rule.source_name,
                    rule.column,
                    rule.rule_type,
                    rule.description,
                    rule.evidence,
                    rule.created_at,
                ),
            )
        return rule

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    @contextmanager
    def _read(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _write(self) -> _LockedConnection:
        return _LockedConnection(self._lock, self._connect())

    @staticmethod
    def _ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
        columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()}
        if column_name not in columns:
            connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


class _LockedConnection:
    def __init__(self, lock: RLock, connection: sqlite3.Connection) -> None:
        self.lock = lock
        self.connection = connection

    def __enter__(self) -> sqlite3.Connection:
        self.lock.acquire()
        return self.connection

    def __exit__(self, exc_type, exc, traceback) -> None:
        try:
            if exc_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
        finally:
            self.connection.close()
            self.lock.release()


def _sqlite_path_from_settings() -> str:
    url = get_settings().database_url
    prefix = "sqlite:///"
    if url.startswith(prefix):
        return url[len(prefix):]
    return "./data/agent_state.db"


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, default=str)


def _load_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _metadata_user_id(metadata: dict[str, object] | None) -> str:
    value = (metadata or {}).get("user_id")
    return str(value or "anonymous")[:128]


def _run_from_row(row: sqlite3.Row) -> AgentRun:
    metrics = _load_json(row["metrics_json"], {})
    if "user_id" in row.keys() and "user_id" not in metrics:
        metrics["user_id"] = row["user_id"]
    return AgentRun(
        run_id=row["run_id"],
        source_name=row["source_name"],
        source_type=row["source_type"],
        status=row["status"],
        started_at=row["started_at"],
        updated_at=row["updated_at"],
        metrics=metrics,
    )


def _trace_from_row(row: sqlite3.Row) -> AgentTraceEvent:
    return AgentTraceEvent(
        run_id=row["run_id"],
        trace_id=row["trace_id"],
        span_id=row["span_id"],
        parent_span_id=row["parent_span_id"],
        event_type=row["event_type"],
        component=row["component"],
        tool_name=row["tool_name"],
        input_summary=row["input_summary"],
        output_summary=row["output_summary"],
        status=row["status"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        duration_ms=row["duration_ms"],
        error_message=row["error_message"],
        metadata=_load_json(row["metadata_json"], {}),
    )


def _hitl_from_row(row: sqlite3.Row) -> HitlRecord:
    return HitlRecord(
        id=row["id"],
        run_id=row["run_id"],
        type=row["type"],
        severity=row["severity"],
        source=row["source"],
        table=row["table_name"],
        columns=_load_json(row["columns_json"], []),
        evidence=row["evidence"],
        proposed_action=row["proposed_action"],
        status=row["status"],
        reviewer=row["reviewer"],
        reviewed_at=row["reviewed_at"],
        comment=row["comment"],
    )


def _conversation_from_row(row: sqlite3.Row) -> Conversation:
    return Conversation(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        message_count=row["message_count"] if "message_count" in row.keys() else 0,
        metadata=_load_json(row["metadata_json"], {}),
    )


def _message_from_row(row: sqlite3.Row) -> ChatMessage:
    return ChatMessage(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=row["content"],
        run_id=row["run_id"],
        created_at=row["created_at"],
        metadata=_load_json(row["metadata_json"], {}),
    )


def _profile_report_summary_from_row(row: sqlite3.Row) -> ProfileReportSummary:
    return ProfileReportSummary(
        run_id=row["run_id"],
        user_id=row["user_id"] if "user_id" in row.keys() else "anonymous",
        source_name=row["source_name"],
        source_type=row["source_type"],
        row_count=row["row_count"],
        column_count=row["column_count"],
        warning_count=row["warning_count"],
        critical_count=row["critical_count"],
        created_at=row["created_at"],
    )


def _profile_report_from_row(row: sqlite3.Row) -> ProfileReportRecord:
    summary = _profile_report_summary_from_row(row)
    return ProfileReportRecord(
        **summary.model_dump(),
        report=ProfileResult.model_validate(_load_json(row["report_json"], {})),
    )


def _report_comment_from_row(row: sqlite3.Row) -> ReportComment:
    return ReportComment(
        id=row["id"],
        run_id=row["run_id"],
        user_id=row["user_id"],
        author_name=row["author_name"],
        comment=row["comment"],
        column=row["column_name"],
        created_at=row["created_at"],
    )


def _user_workspace_from_row(row: sqlite3.Row) -> UserWorkspace:
    return UserWorkspace(
        user_id=row["user_id"],
        display_name=row["display_name"],
        role=row["role"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        metadata=_load_json(row["metadata_json"], {}),
    )


def _knowledge_document_from_row(row: sqlite3.Row) -> KnowledgeDocument:
    return KnowledgeDocument(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        content_type=row["content_type"],
        size=row["size"],
        status=row["status"],
        extracted_text=row["extracted_text"],
        summary=row["summary"],
        created_at=row["created_at"],
    )


def _profiling_plan_from_row(row: sqlite3.Row) -> ProfilingPlan:
    return ProfilingPlan(
        id=row["id"],
        user_id=row["user_id"],
        source_name=row["source_name"],
        selected_sections=_load_json(row["selected_sections_json"], []),
        custom_requirements=row["custom_requirements"],
        items=[
            ProfilingPlanItem.model_validate(item)
            for item in _load_json(row["items_json"], [])
        ],
        clarification_questions=_load_json(row["clarification_questions_json"], []),
        confirmed=bool(row["confirmed"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _user_rule_from_row(row: sqlite3.Row) -> UserRule:
    return UserRule(
        id=row["id"],
        user_id=row["user_id"],
        source_name=row["source_name"],
        column=row["column_name"],
        rule_type=row["rule_type"],
        description=row["description"],
        evidence=row["evidence"],
        created_at=row["created_at"],
    )


agent_repository = AgentRepository()
