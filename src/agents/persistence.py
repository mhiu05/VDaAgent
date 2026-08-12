"""SQLite persistence for agent observability, governance, and chat history.

This repository keeps the agent domain independent from a specific ORM. Each
operation opens a short-lived connection so FastAPI worker threads can safely
share the repository without sharing SQLite connection objects.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any

from src.config import get_settings
from src.models.schemas import (
    AgentRun,
    AgentTraceEvent,
    ChatMessage,
    Conversation,
    HitlRecord,
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
                """
            )

    def save_run(self, run: AgentRun) -> AgentRun:
        with self._write() as connection:
            connection.execute(
                """
                INSERT INTO agent_runs (
                    run_id, source_name, source_type, status, started_at, updated_at, metrics_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    source_name = excluded.source_name,
                    source_type = excluded.source_type,
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    metrics_json = excluded.metrics_json
                """,
                (
                    run.run_id,
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

    def list_runs(self, limit: int = 100, offset: int = 0) -> list[AgentRun]:
        with self._read() as connection:
            rows = connection.execute(
                "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
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
        with self._write() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO hitl_records (
                    id, run_id, type, severity, source, table_name, columns_json, evidence,
                    proposed_action, status, reviewer, reviewed_at, comment
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
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


def _run_from_row(row: sqlite3.Row) -> AgentRun:
    return AgentRun(
        run_id=row["run_id"],
        source_name=row["source_name"],
        source_type=row["source_type"],
        status=row["status"],
        started_at=row["started_at"],
        updated_at=row["updated_at"],
        metrics=_load_json(row["metrics_json"], {}),
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


agent_repository = AgentRepository()
