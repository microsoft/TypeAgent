# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from typing import Any, Callable

from .interfaces import (
    # Interfaces.
    IConversation,
    IMessage,
    ITermToSemanticRefIndex,
    ITermToSemanticRefIndexData,
    ITermToSemanticRefIndexItem,
    # Other imports.
    IndexingEventHandlers,
    IndexingResults,
    Knowledge,
    KnowledgeType,
    MessageOrdinal,
    SemanticRefOrdinal,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    TextLocation,
    TextRange,
)
from . import kplib
from .knowledge import facet_value_to_string


def text_range_from_location(
    message_ordinal: MessageOrdinal,
    chunk_ordinal: int = 0,
) -> TextRange:
    return TextRange(
        start=TextLocation(message_ordinal, chunk_ordinal),
        end=None,
    )


type KnowledgeValidator = Callable[
    [
        KnowledgeType,  # knowledge_type
        Knowledge,  # knowledge
    ],
    bool,
]


def default_knowledge_validator(
    knowledg_Type: KnowledgeType,
    knowledge: Knowledge,
) -> bool:
    return True


def add_entity_to_index(
    entity: kplib.ConcreteEntity,
    semantic_refs: list[SemanticRef],
    semantic_ref_index: ITermToSemanticRefIndex,
    message_ordinal: MessageOrdinal,
    chunk_ordinal: int = 0,
) -> None:
    ref_ordinal = len(semantic_refs)
    semantic_refs.append(
        SemanticRef(
            semantic_ref_ordinal=ref_ordinal,
            range=text_range_from_location(message_ordinal, chunk_ordinal),
            knowledge_type="entity",
            knowledge=entity,
        )
    )
    semantic_ref_index.add_term(entity.name, ref_ordinal)
    # Add each type as a separate term.
    for type in entity.type:
        semantic_ref_index.add_term(type, ref_ordinal)
    # Add every facet name as a separate term.
    if entity.facets:
        for facet in entity.facets:
            add_facet(facet, ref_ordinal, semantic_ref_index)


def add_facet(facet, ref_index, semantic_ref_index):
    if facet is not None:
        semantic_ref_index.add_term(facet.name, ref_index)
        if facet.value is not None:
            semantic_ref_index.add_term(facet_value_to_string(facet), ref_index)


def add_metadata_to_index[TMessage: IMessage](
    messages: list[TMessage],
    semantic_refs: list[SemanticRef],
    semantic_ref_index: ITermToSemanticRefIndex,
    knowledge_validator: KnowledgeValidator | None = None,
) -> None:
    if knowledge_validator is None:
        knowledge_validator = default_knowledge_validator
    for i, msg in enumerate(messages):
        knowledge_response = msg.get_knowledge()
        for entity in knowledge_response.entities:
            if knowledge_validator("entity", entity):
                add_entity_to_index(entity, semantic_refs, semantic_ref_index, i)


@dataclass
class ConversationIndex(ITermToSemanticRefIndex):
    _map: dict[str, list[ScoredSemanticRefOrdinal]]

    def __init__(self, data: ITermToSemanticRefIndexData | None = None):
        self._map = {}
        if data:
            self.deserialize(data)

    def __len__(self) -> int:
        return len(self._map)

    def get_terms(self) -> list[str]:
        return list(self._map)

    def add_term(
        self,
        term: str,
        semantic_ref_ordinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ) -> None:
        if not term:
            return
        if not isinstance(semantic_ref_ordinal, ScoredSemanticRefOrdinal):
            semantic_ref_ordinal = ScoredSemanticRefOrdinal(semantic_ref_ordinal, 1.0)
        term = self._prepare_term(term)
        existing = self._map.get(term)
        if existing is not None:
            existing.append(semantic_ref_ordinal)
        else:
            self._map[term] = [semantic_ref_ordinal]

    def remove_term(self, term: str, semantic_ref_ordinal: SemanticRefOrdinal) -> None:
        self._map.pop(self._prepare_term(term), None)

    def remove_term_if_empty(self, term: str) -> None:
        """Clean up a term if it has lost its last semantic reference."""
        term = self._prepare_term(term)
        if term in self._map and len(self._map[term]) == 0:
            self.map.pop(term)

    def lookup_term(self, term: str) -> list[ScoredSemanticRefOrdinal] | None:
        return self._map.get(self._prepare_term(term)) or []

    def serialize(self) -> ITermToSemanticRefIndexData:
        items: list[ITermToSemanticRefIndexItem] = []
        for term, semantic_ref_ordinals in self._map:
            items.append(
                ITermToSemanticRefIndexItem(
                    term=term,
                    semantic_ref_ordinals=semantic_ref_ordinals,
                )
            )
        return ITermToSemanticRefIndexData(items)

    def deserialize(self, data: ITermToSemanticRefIndexData) -> None:
        raise NotImplementedError

    def _prepare_term(self, term: str) -> str:
        return term.lower()


# ...


async def build_conversation_index(
    conversation: IConversation,
    conversation_settings: Any,  # TODO: ConversationSettings
    event_handler: IndexingEventHandlers | None = None,
) -> IndexingResults:
    result = IndexingResults()
    # TODO
    # result.semantic_refs = await build_semantic_ref_index(conversation, None, event_handler)
    # if result.semantic_refs and not result.semantic_refs.error and conversation.semantic_ref_index:
    #     result.secondary_index_results = await build_secondary_indexes(
    #         conversation, conversation_settings, event_handler
    #     )
    return result
