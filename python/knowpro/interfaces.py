# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# TODO:
# - See TODOs in kplib.py.
#
# NOTE:
# - I took some liberty with index types and made them int.
# - I rearranged the order in some cases to ensure def-before-ref.
# - I translated readonly to @property.

from typing import Any, Callable, Literal, Protocol, runtime_checkable, Sequence
from datetime import datetime as Date

from . import kplib


# An object that can provide a KnowledgeResponse structure.
@runtime_checkable
class IKnowledgeSource(Protocol):
    def get_knowledge(self) -> kplib.KnowledgeResponse:
        raise NotImplementedError


@runtime_checkable
class DeletionInfo(Protocol):
    timestamp: str
    reason: str | None


@runtime_checkable
class IMessage[TMeta: IKnowledgeSource = Any](Protocol):
    # The text of the message, split into chunks.
    text_chunks: Sequence[str]
    # For example, e-mail has subject, from and to fields;
    # a chat message has a sender and a recipient.
    metadata: TMeta
    timestamp: str | None = None
    tags: Sequence[str]
    deletion_info: DeletionInfo | None = None


type SemanticRefIndex = int


@runtime_checkable
class ScoredSemanticRef(Protocol):
    semantic_ref_index: SemanticRefIndex
    score: float


@runtime_checkable
class ITermToSemanticRefIndex(Protocol):
    def getTerms(self) -> Sequence[str]:
        raise NotImplementedError

    def addTerm(
        self,
        term: str,
        semantic_ref_index: SemanticRefIndex | ScoredSemanticRef,
    ) -> None:
        raise NotImplementedError

    def removeTerm(self, term: str, semantic_ref_index: SemanticRefIndex) -> None:
        raise NotImplementedError

    def lookupTerm(self, term: str) -> Sequence[ScoredSemanticRef] | None:
        raise NotImplementedError


type KnowledgeType = Literal["entity", "action", "topic", "tag"]


type MessageIndex = int


@runtime_checkable
class Topic(Protocol):
    text: str


@runtime_checkable
class Tag(Protocol):
    text: str


type Knowledge = kplib.ConcreteEntity | kplib.Action | Topic | Tag


@runtime_checkable
class TextLocation(Protocol):
    # The index of the message.
    message_index: MessageIndex
    # The index of the chunk.
    chunkIndex: int | None
    # The index of the character within the chunk.
    charIndex: int | None


# A text range within a session.
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
class DateRange(Protocol):
    start: Date
    # Inclusive.
    end: Date | None


@runtime_checkable
class Term(Protocol):
    text: str
    # Optional weighting for these matches.
    weight: float | None


@runtime_checkable
class ScoredKnowledge(Protocol):
    knowledge_type: KnowledgeType
    knowledge: Knowledge
    score: float


# Allows for faster retrieval of name, value properties
@runtime_checkable
class IPropertyToSemanticRefIndex(Protocol):
    def get_values(self) -> Sequence[str]:
        raise NotImplementedError

    def add_property(
        self,
        property_name: str,
        value: str,
        semantic_ref_index: SemanticRefIndex | ScoredSemanticRef,
    ) -> None:
        raise NotImplementedError

    def lookup_property(
        self, property_name: str, value: str
    ) -> Sequence[ScoredSemanticRef] | None:
        raise NotImplementedError


@runtime_checkable
class TimestampedTextRange(Protocol):
    timestamp: str
    range: TextRange


# Return text ranges in the given date range.
@runtime_checkable
class ITimestampToTextRangeIndex(Protocol):
    def add_timestamp(self, message_index: MessageIndex, timestamp: str) -> None:
        raise NotImplementedError

    def add_timestamps(
        self, message_imestamps: Sequence[tuple[MessageIndex, str]]
    ) -> bool:
        raise NotImplementedError

    def lookup_range(self, date_range: DateRange) -> Sequence[TimestampedTextRange]:
        raise NotImplementedError


@runtime_checkable
class ITermToRelatedTerms(Protocol):
    def lookup_term(self, text: str) -> Sequence[Term] | None:
        raise NotImplementedError


@runtime_checkable
class ITermToRelatedTermsFuzzy(Protocol):
    async def add_terms(
        self, terms: Sequence[str], event_handler: "IndexingEventHandlers | None" = None
    ) -> None:
        raise NotImplementedError

    async def lookup_term(
        self,
        text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> Sequence[Term]:
        raise NotImplementedError

    async def lookup_terms(
        self,
        text_array: Sequence[str],
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> Sequence[Sequence[Term]]:
        raise NotImplementedError


@runtime_checkable
class ITermToRelatedTermsIndex(Protocol):
    @property
    def aliases(self) -> ITermToRelatedTerms | None:
        raise NotImplementedError

    @property
    def fuzzy_index(self) -> ITermToRelatedTermsFuzzy | None:
        raise NotImplementedError


# A Thread is a set of text ranges in a conversation.
@runtime_checkable
class Thread(Protocol):
    description: str
    ranges: Sequence[TextRange]


type ThreadIndex = int


@runtime_checkable
class ScoredThreadIndex(Protocol):
    thread_index: ThreadIndex
    score: float


@runtime_checkable
class IConversationThreads(Protocol):
    @property
    def threads(self) -> Sequence[Thread]:
        raise NotImplementedError

    async def add_thread(self, thread: Thread) -> None:
        raise NotImplementedError

    async def lookup_thread(
        self,
        thread_description: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> Sequence[ScoredThreadIndex] | None:
        raise NotImplementedError


@runtime_checkable
class IConversationSecondaryIndexes(Protocol):
    property_to_semantic_ref_index: IPropertyToSemanticRefIndex | None
    timestampIndex: ITimestampToTextRangeIndex | None
    termToRelatedTermsIndex: ITermToRelatedTermsIndex | None
    threads: IConversationThreads | None


@runtime_checkable
class IConversation[TMeta: IKnowledgeSource = Any](Protocol):
    name_tag: str
    tags: Sequence[str]
    messages: Sequence[IMessage[TMeta]]
    semantic_refs: Sequence[SemanticRef] | None
    semantic_ref_index: ITermToSemanticRefIndex | None
    secondaryIndexes: IConversationSecondaryIndexes | None


# ------------------------
# Serialization formats
# ------------------------


@runtime_checkable
class ITermToSemanticRefIndexItem(Protocol):
    term: str
    semantic_ref_indices: Sequence[ScoredSemanticRef]


# Persistent form of a term index.
@runtime_checkable
class ITermToSemanticRefIndexData(Protocol):
    items: Sequence[ITermToSemanticRefIndexItem]


@runtime_checkable
class IConversationData[TMessage](Protocol):
    name_tag: str
    messages: Sequence[TMessage]
    tags: Sequence[str]
    semantic_refs: Sequence[SemanticRef]
    semantic_index_data: ITermToSemanticRefIndexData | None


# ------------------------
# Indexing
# ------------------------


@runtime_checkable
class IndexingEventHandlers(Protocol):
    on_knowledge_xtracted: (
        Callable[
            [
                TextLocation,
                kplib.KnowledgeResponse,
            ],
            bool,
        ]
        | None
    ) = None
    on_embeddings_created: (
        Callable[
            [
                Sequence[str],
                Sequence[str],
                int,
            ],
            bool,
        ]
        | None
    ) = None


@runtime_checkable
class IndexingResults(Protocol):
    chunksIndexedUpto: TextLocation | None = None
    error: str | None = None
