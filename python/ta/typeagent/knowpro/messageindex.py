# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
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
    TextLocation,
)
from .textlocationindex import ScoredTextLocation, TextToTextLocationIndex


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
        raise NotImplementedError  # TODO

    def lookup_in_subset_by_embedding(
        self,
        text_embedding: NormalizedEmbedding,
        ordinals_to_search: list[MessageOrdinal],
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        raise NotImplementedError  # TODO


class MessageTextIndex(IMessageTextEmbeddingIndex):
    def __init__(self, settings: MessageTextIndexSettings | None = None):
        if settings is None:
            settings = MessageTextIndexSettings()
        self.settings = settings
        self.text_location_index = TextToTextLocationIndex(
            settings.embedding_index_settings
        )

    def __len__(self) -> int:
        return len(self.text_location_index)

    def __bool__(self) -> bool:
        return True

    async def add_messages(
        self,
        messages: list[IMessage],
        event_handler: IndexingEventHandlers | None = None,
    ) -> ListIndexingResult:
        base_message_ordinal: MessageOrdinal = len(self.text_location_index)
        all_chunks: list[tuple[str, TextLocation]] = []
        # Collect everything so we can batch efficiently.
        for message_ordinal, message in enumerate(messages, base_message_ordinal):
            for chunk_ordinal, chunk in enumerate(message.text_chunks):
                all_chunks.append((chunk, TextLocation(message_ordinal, chunk_ordinal)))
        return await self.text_location_index.add_text_locations(
            all_chunks, event_handler
        )

    async def lookup_messages(
        self,
        message_text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        max_matches = max_matches or self.settings.embedding_index_settings.max_matches
        threshold_score = (
            threshold_score or self.settings.embedding_index_settings.min_score
        )
        scored_text_locations = await self.text_location_index.lookup_text(
            message_text, max_matches, threshold_score
        )
        return self.to_scored_message_ordinals(scored_text_locations)

    async def lookup_messages_in_subset(
        self,
        message_text: str,
        ordinals_to_search: list[MessageOrdinal],
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredMessageOrdinal]:
        scored_text_locations = await self.text_location_index.lookup_text_in_subset(
            message_text, ordinals_to_search, max_matches, threshold_score
        )
        return self.to_scored_message_ordinals(scored_text_locations)

    async def generate_embedding(self, text: str) -> NormalizedEmbedding:
        # Note: if you rename generate_embedding, be sure to also fix is_message_text_embedding_index.
        # TODO: Retries?
        return await self.text_location_index._vector_base.get_embedding(text)

    # TODO: Waiting for text_location_index.lookup_in_subset_by_embeddings.
    # def lookup_in_subset_by_embedding(
    #     self,
    #     text_embedding: NormalizedEmbedding,
    #     ordinals_to_search: list[MessageOrdinal],
    #     max_matches: int | None = None,
    #     threshold_score: float | None = None,
    # ) -> list[ScoredMessageOrdinal]:
    #     scored_text_locations = self.text_location_index.lookup_in_subset_by_embedding(
    #         text_embedding, ordinals_to_search, max_matches, threshold_score
    #     )
    #     return self.to_scored_message_ordinals(scored_text_locations)

    def to_scored_message_ordinals(
        self, scored_locations: list[ScoredTextLocation]
    ) -> list[ScoredMessageOrdinal]:
        message_matches = MessageAccumulator()
        message_matches.add_messages_from_locations(scored_locations)
        return message_matches.to_scored_message_ordinals()


@dataclass
class Match[T]:
    value: T
    score: float
    hit_count: int
    related_score: float
    related_hit_ount: int


class MessageAccumulator:
    def __init__(self):
        self._matches: dict[MessageOrdinal, Match[MessageOrdinal]] = {}

    def __len__(self) -> int:
        return len(self._matches)

    def __bool__(self) -> bool:
        return True

    def __contains__(self, key: MessageOrdinal) -> bool:
        return key in self._matches

    def get_match(self, key: MessageOrdinal) -> Match[MessageOrdinal] | None:
        return self._matches.get(key)

    def set_match(self, match: Match[MessageOrdinal]) -> None:
        self._matches[match.value] = match

    def add(self, value: MessageOrdinal, score: float) -> None:
        match = self.get_match(value)
        if match is None:
            self.set_match(
                Match(
                    value=value,
                    score=score,
                    hit_count=1,
                    related_score=score,
                    related_hit_ount=1,
                )
            )
        else:
            match.score = max(score, match.score)
            match.hit_count += 1

    def add_messages_from_locations(
        self,
        scored_text_locations: list[ScoredTextLocation],
    ) -> None:
        for sl in scored_text_locations:
            self.add(sl.text_location.message_ordinal, sl.score)

    def to_scored_message_ordinals(self) -> list[ScoredMessageOrdinal]:
        matches = sorted(
            self._matches.values(), key=lambda match: match.score, reverse=True
        )
        return [
            ScoredMessageOrdinal(
                message_ordinal=match.value,
                score=match.score,
            )
            for match in matches
        ]
