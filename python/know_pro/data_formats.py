# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# TODO:
# - Rename to something else once Steve reveals what.
# - See TODOs in knowledge_schema.py.
# - Should we use ABC instead of Protocol for certain classes?

from typing import Any, Literal, Protocol, runtime_checkable

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


type SemanticRefIndex = float


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
