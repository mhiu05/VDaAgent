"""Persistent chat history service with PII-safe stored messages.

The live request can still be sent to the agent, while the durable audit copy
is masked before it reaches SQLite. Conversation ownership is validated using
the caller's user identifier until a real authentication layer is available.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from src.agents.persistence import AgentRepository, agent_repository
from src.agents.pii import mask_text
from src.models.schemas import ChatMessage, Conversation


class ChatStore:
    def __init__(self, repository: AgentRepository | None = None) -> None:
        self.repository = repository or agent_repository

    def create_conversation(self, user_id: str, title: str = "New conversation") -> Conversation:
        now = _now()
        conversation = Conversation(
            id=str(uuid4()),
            user_id=user_id,
            title=mask_text(title.strip())[:160] or "New conversation",
            created_at=now,
            updated_at=now,
        )
        return self.repository.save_conversation(conversation)

    def get_or_create_conversation(
        self,
        conversation_id: str | None,
        user_id: str,
        first_message: str,
    ) -> Conversation:
        if conversation_id:
            conversation = self.repository.get_conversation(conversation_id)
            if conversation is None:
                raise LookupError("Conversation not found.")
            if conversation.user_id != user_id:
                raise PermissionError("Conversation does not belong to this user.")
            return conversation
        title = mask_text(first_message).strip().replace("\n", " ")[:72]
        return self.create_conversation(user_id, title or "New conversation")

    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        run_id: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> ChatMessage:
        message = ChatMessage(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role=role,
            content=mask_text(content),
            run_id=run_id,
            created_at=_now(),
            metadata=metadata or {},
        )
        return self.repository.save_chat_message(message)

    def list_conversations(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Conversation]:
        return self.repository.list_conversations(user_id, limit=limit, offset=offset)

    def list_messages(
        self,
        conversation_id: str,
        user_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> list[ChatMessage]:
        conversation = self.repository.get_conversation(conversation_id)
        if conversation is None:
            raise LookupError("Conversation not found.")
        if conversation.user_id != user_id:
            raise PermissionError("Conversation does not belong to this user.")
        return self.repository.list_chat_messages(conversation_id, limit=limit, offset=offset)


chat_store = ChatStore()


def _now() -> str:
    return datetime.now(UTC).isoformat()
