# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass, field
from typing import Callable

from .interfaces import (
    # Interfaces.
    IConversation,
    IMessage,
    ITermToSemanticRefIndex,
    ITermToSemanticRefIndexData,
    # Other imports.
    IndexingEventHandlers,
    IndexingResults,
    Knowledge,
    KnowledgeType,
    MessageIndex,
    ScoredSemanticRef,
    SemanticRef,
    TextLocation,
    TextRange,
)


def text_range_from_location(
    message_index: MessageIndex,
    chunk_index: int = 0,
) -> TextRange:
    return TextRange(
        start=TextLocation(message_index, chunk_index),
        end=None,
    )


type KnowledgeValidator = Callable[
    [
        KnowledgeType,  # knowledgeType
        Knowledge,  # knowledge
    ],
    bool,
]


def add_metadata_to_index(
    messages: list[IMessage],
    semantic_refs: list[SemanticRef],
    semantic_ref_index: ITermToSemanticRefIndex,
    knowledge_validator: KnowledgeValidator | None = None,
) -> None:
    raise NotImplementedError


@dataclass
class ConversationIndex(ITermToSemanticRefIndex):
    _map: dict[str, list[ScoredSemanticRef]] = field(default_factory=dict)

    def __init__(self, data: ITermToSemanticRefIndexData | None = None):
        if data:
            self.deserialize(data)

    # TODO: More methods

    def deserialize(self, data: ITermToSemanticRefIndexData) -> None:
        raise NotImplementedError


# ...


async def build_conversation_index(
    conversation: IConversation,
    event_handler: IndexingEventHandlers | None = None,
) -> IndexingResults:
    raise NotImplementedError
