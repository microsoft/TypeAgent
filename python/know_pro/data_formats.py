# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# TODO:
# - Rename this file to something else once Steve reveals what.
# - See TODOs in knowledge_schema.py.
#
# NOTE:
# - I took some liberty with index types and made them int.
# - I rearranged the order in some cases to ensure def-before-ref.

from typing import Any, Literal, Protocol, runtime_checkable
from datetime import datetime as Date

from .knowledge_schema import (
    KnowledgeResponse,
    ConcreteEntity,
    Action,
)


@runtime_checkable
class IKnowledgeSource(Protocol):
    """An object that can provide a KnowledgeResponse structure."""

    def get_knowledge(self) -> KnowledgeResponse:
        raise NotImplementedError


@runtime_checkable
class DeletionInfo(Protocol):
    timestamp: str
    reason: str | None


@runtime_checkable
class IMessage[TMeta: IKnowledgeSource = Any](Protocol):
    # The text of the message, split into chunks.
    text_chunks: list[str]
    # For example, e-mail has subject, from and to fields;
    # a chat message has a sender and a recipient.
    metadata: TMeta
    timestamp: str | None = None
    tags: list[str]
    deletion_info: DeletionInfo | None = None


type SemanticRefIndex = int


@runtime_checkable
class ScoredSemanticRef(Protocol):
    semantic_ref_index: SemanticRefIndex
    score: float


@runtime_checkable
class ITermToSemanticRefIndexItem(Protocol):
    term: str
    semantic_ref_indices: list[ScoredSemanticRef]


@runtime_checkable
class ITermToSemanticRefIndexData(Protocol):
    """Persistent form of a term index."""

    items: list[ITermToSemanticRefIndexItem]


@runtime_checkable
class ITermToSemanticRefIndex(Protocol):
    def getTerms(self) -> list[str]:
        raise NotImplementedError

    def addTerm(
        self,
        term: str,
        semantic_ref_index: SemanticRefIndex | ScoredSemanticRef,
    ) -> None:
        raise NotImplementedError

    def removeTerm(self, term: str, semantic_ref_index: SemanticRefIndex) -> None:
        raise NotImplementedError

    def lookupTerm(self, term: str) -> list[ScoredSemanticRef] | None:
        raise NotImplementedError


type KnowledgeType = Literal["entity", "action", "topic", "tag"]


type MessageIndex = int


@runtime_checkable
class Topic(Protocol):
    text: str


@runtime_checkable
class Tag(Protocol):
    text: str


type Knowledge = ConcreteEntity | Action | Topic | Tag


@runtime_checkable
class TextLocation(Protocol):
    # The index of the message.
    message_index: MessageIndex
    # The index of the chunk.
    chunkIndex: int | None
    # The index of the character within the chunk.
    charIndex: int | None


@runtime_checkable
class TextRange(Protocol):
    # The start of the range.
    start: TextLocation
    # The end of the range (exclusive).
    end: TextLocation | None


@runtime_checkable
class SemanticRef(Protocol):
    semantic_ref_index: SemanticRefIndex
    range: TextRange
    knowledge_type: KnowledgeType
    knowledge: Knowledge


@runtime_checkable
class IConversation[TMeta: IKnowledgeSource = Any](Protocol):
    name_tag: str
    tags: list[str]
    messages: list[IMessage[TMeta]]
    semantic_refs: list[SemanticRef] | None
    semantic_ref_index: ITermToSemanticRefIndex | None


@runtime_checkable
class IConversationData[TMessage](Protocol):
    name_tag: str
    messages: list[TMessage]
    tags: list[str]
    semantic_refs: list[SemanticRef]
    semantic_index_data: ITermToSemanticRefIndexData | None


@runtime_checkable
class DateRange(Protocol):
    start: Date
    # Inclusive.
    end: Date | None


@runtime_checkable
class Term(Protocol):
    text: str
    # Optional weighting for these matches.
    weight: float | None


# Also see:
# - secondaryIndex.ts for optional secondary interfaces.
# - search.ts for search interfaces.
# - thread.ts for early ideas on threads.
