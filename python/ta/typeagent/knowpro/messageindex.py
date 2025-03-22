# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typing import Any

from ..aitools.embeddings import NormalizedEmbedding
from .importing import ConversationSettings, MessageTextIndexSettings
from .interfaces import (
    IConversation,
    IMessage,
    IMessageTextIndex,
    IndexingEventHandlers,
    ListIndexingResult,
    MessageOrdinal,
    ScoredMessageOrdinal,
)
from .textlocationindex import TextToTextLocationIndex


async def build_message_index(
    conversation: IConversation,
    settings: MessageTextIndexSettings | None = None,
    event_handler: IndexingEventHandlers | None = None,
) -> ListIndexingResult:
    if conversation.secondary_indexes is None:
        return ListIndexingResult(0)
    if conversation.secondary_indexes.message_index is None:
        conversation.secondary_indexes.message_index = MessageTextIndex(settings)
    message_index = conversation.secondary_indexes.message_index
    messages = conversation.messages
    return await message_index.add_messages(messages, event_handler)


class IMessageTextEmbeddingIndex(IMessageTextIndex):
    async def generate_embedding(self, text: str) -> NormalizedEmbedding:
        raise NotImplementedError

    def lookup_in_subset_by_embedding(
        self,
        text_embedding: NormalizedEmbedding,
        ordinals_to_search: list[MessageOrdinal],
        max_matches: int | None = None,
        threashold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        raise NotImplementedError  #


class MessageTextIndex(IMessageTextEmbeddingIndex):
    def __init__(self, settings: MessageTextIndexSettings | None = None):
        self.settings = settings
        self.text_location_index = TextToTextLocationIndex()

    def __len__(self) -> int:
        return len(self.text_location_index)

    def __bool__(self) -> bool:
        return True

    async def add_messages(
        self,
        messages: list[IMessage],
        event_handler: IndexingEventHandlers | None = None,
    ) -> ListIndexingResult:
        raise NotImplementedError  # TODO

    async def lookup_messages(
        self,
        message_text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        raise NotImplementedError  # TODO

    async def lookup_messages_in_subset(
        self,
        *args,
        **kwds,
    ) -> Any:
        raise NotImplementedError  # TODO
