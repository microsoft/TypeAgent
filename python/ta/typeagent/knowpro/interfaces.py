# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# TODO:
# - See TODOs in kplib.py.
# - Do the Protocol classes need to be @runtime_checkable?
#
# NOTE:
# - I took some liberty with index types and made them int.
# - I rearranged the order in some cases to ensure def-before-ref.
# - I translated readonly to @property.

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime as Datetime
from typing import Any, Callable, Literal, Protocol, runtime_checkable

from . import kplib


# An object that can provide a KnowledgeResponse structure.
@runtime_checkable
class IKnowledgeSource(Protocol):
    def get_knowledge(self) -> kplib.KnowledgeResponse:
        raise NotImplementedError


@dataclass
class DeletionInfo:
    timestamp: str
    reason: str | None = None


type MessageOrdinal = int


@runtime_checkable
class IMessage(IKnowledgeSource, Protocol):
    # The text of the message, split into chunks.
    text_chunks: list[str]
    timestamp: str | None = None
    tags: list[str]
    deletion_info: DeletionInfo | None = None


type SemanticRefOrdinal = int


@dataclass
class ScoredSemanticRefOrdinal:
    semantic_ref_ordinal: SemanticRefOrdinal
    score: float


@dataclass
class ScoredMessageOrdinal:
    message_ordinal: MessageOrdinal
    score: float


@runtime_checkable
class ITermToSemanticRefIndex(Protocol):
    def get_terms(self) -> Sequence[str]:
        raise NotImplementedError

    def add_term(
        self,
        term: str,
        semantic_ref_ordinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ) -> None:
        raise NotImplementedError

    def remove_term(self, term: str, semantic_ref_ordinal: SemanticRefOrdinal) -> None:
        raise NotImplementedError

    def lookup_term(self, term: str) -> Sequence[ScoredSemanticRefOrdinal] | None:
        raise NotImplementedError


type KnowledgeType = Literal["entity", "action", "topic", "tag"]


@dataclass
class Topic:
    text: str


@dataclass
class Tag:
    text: str


type Knowledge = kplib.ConcreteEntity | kplib.Action | Topic | Tag


@dataclass
class TextLocation:
    # The index of the message.
    message_ordinal: MessageOrdinal
    # The index of the chunk.
    chunk_ordinal: int = 0
    # The index of the character within the chunk.
    char_ordinal: int = 0


# A text range within a session.
@dataclass
class TextRange:
    # The start of the range.
    start: TextLocation
    # The end of the range (exclusive).
    end: TextLocation | None = None


@dataclass
class SemanticRef:
    semantic_ref_ordinal: SemanticRefOrdinal
    range: TextRange
    knowledge_type: KnowledgeType
    knowledge: Knowledge


@dataclass
class DateRange:
    start: Datetime
    # Inclusive.  # TODO: Really? Shouldn't this be exclusive?
    end: Datetime | None = None


@dataclass
class Term:
    text: str
    # Optional weighting for these matches.
    weight: float | None = None


@dataclass
class ScoredKnowledge:
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
        semantic_ref_ordinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ) -> None:
        raise NotImplementedError

    def lookup_property(
        self, property_name: str, value: str
    ) -> Sequence[ScoredSemanticRefOrdinal] | None:
        raise NotImplementedError


@dataclass
class TimestampedTextRange:
    timestamp: str
    range: TextRange


# Return text ranges in the given date range.
@runtime_checkable
class ITimestampToTextRangeIndex(Protocol):
    def add_timestamp(self, message_ordinal: MessageOrdinal, timestamp: str) -> bool:
        raise NotImplementedError

    def add_timestamps(
        self, message_imestamps: Sequence[tuple[MessageOrdinal, str]]
    ) -> None:
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
    ) -> "ListIndexingResult":
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
@dataclass
class Thread:
    description: str
    ranges: Sequence[TextRange]


type ThreadOrdinal = int


@dataclass
class ScoredThreadIndex:
    thread_ordinal: ThreadOrdinal
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
    timestamp_index: ITimestampToTextRangeIndex | None
    term_to_related_terms_index: ITermToRelatedTermsIndex | None
    threads: IConversationThreads | None
    message_index: "IMessageTextIndex | None" = None


@runtime_checkable
class IConversation[
    TMessage: IMessage,
    TTermToSemanticRefIndex: ITermToSemanticRefIndex,
    TConversationSecondaryIndexes: IConversationSecondaryIndexes,
](Protocol):
    name_tag: str
    tags: list[str]
    messages: list[TMessage]
    semantic_refs: list[SemanticRef] | None
    semantic_ref_index: TTermToSemanticRefIndex | None
    secondary_indexes: TConversationSecondaryIndexes | None


@runtime_checkable
class IMessageTextIndex(Protocol):

    async def add_messages(
        self,
        messages: list[IMessage],
        event_handler: "IndexingEventHandlers | None" = None,
    ) -> "ListIndexingResult":
        raise NotImplementedError

    async def lookup_messages(
        self,
        message_text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        raise NotImplementedError

    async def lookup_messages_in_subset(
        self,
        message_text: str,
        ordinals_to_search: list[MessageOrdinal],
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        raise NotImplementedError


# ------------------------
# Serialization formats
# ------------------------


@dataclass
class ITermToSemanticRefIndexItem:
    term: str
    semantic_ref_ordinals: list[ScoredSemanticRefOrdinal]


# Persistent form of a term index.
@dataclass
class ITermToSemanticRefIndexData:
    items: list[ITermToSemanticRefIndexItem]


@dataclass
class IConversationData[TMessage]:
    name_tag: str
    messages: list[TMessage]
    tags: list[str]
    semantic_refs: list[SemanticRef]
    semantic_index_data: ITermToSemanticRefIndexData | None = None


# ------------------------
# Indexing
# ------------------------


# TODO: Should the callables become methods with a default implementation?
@dataclass
class IndexingEventHandlers:
    on_knowledge_extracted: (
        Callable[
            [
                TextLocation,  # chunk
                kplib.KnowledgeResponse,  # knowledge_result
            ],
            bool,
        ]
        | None
    ) = None
    on_embeddings_created: (
        Callable[
            [
                Sequence[str],  # source_texts
                Sequence[str],  # batch
                int,  # batch_start_at
            ],
            bool,
        ]
        | None
    ) = None
    on_text_indexed: (
        Callable[
            [
                list[tuple[str, TextLocation]],  # text_and_locations
                list[tuple[str, TextLocation]],  # batch
                int,  # batch_start_at
            ],
            bool,
        ]
        | None
    ) = None


@dataclass
class TextIndexingResult:
    completedUpto: TextLocation | None = None
    error: str | None = None


@dataclass
class ListIndexingResult:
    number_completed: int
    error: str | None = None


@dataclass
class SecondaryIndexingResults:
    propertie: ListIndexingResult | None = None
    timestamp: ListIndexingResult | None = None
    related_terms: ListIndexingResult | None = None
    message: TextIndexingResult | None = None


@dataclass
class IndexingResults:
    semantic_refs: TextIndexingResult | None = None
    secondary_index_results: SecondaryIndexingResults | None = None
