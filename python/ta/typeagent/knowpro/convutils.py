# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import typechat

from ..aitools.embeddings import AsyncEmbeddingModel
from ..aitools.vectorbase import TextEmbeddingIndexSettings

from .interfaces import (
    DateRange,
    Datetime,
    IConversation,
    IMessage,
    IStorageProvider,
    ITermToSemanticRefIndex,
)


class ConversationSettings:
    """Settings for conversation processing and indexing."""

    def __init__(
        self,
        model: AsyncEmbeddingModel,
        storage_provider: IStorageProvider | None = None,
    ):
        # Import here to avoid circular imports
        from .messageindex import MessageTextIndexSettings
        from .reltermsindex import RelatedTermIndexSettings
        from .semrefindex import SemanticRefIndexSettings

        # All settings share the same model, so they share the embedding cache.
        self.embedding_model = model
        min_score = 0.85
        self.related_term_index_settings = RelatedTermIndexSettings(
            TextEmbeddingIndexSettings(model, min_score=min_score, max_matches=50)
        )
        self.thread_settings = TextEmbeddingIndexSettings(model, min_score=min_score)
        self.message_text_index_settings = MessageTextIndexSettings(
            TextEmbeddingIndexSettings(model, min_score=min_score)
        )
        self.semantic_ref_index_settings = SemanticRefIndexSettings(
            batch_size=10,
            auto_extract_knowledge=False,
        )

        # Storage provider will be created lazily if not provided
        self._storage_provider: IStorageProvider | None = storage_provider
        self._storage_provider_created = storage_provider is not None

    @property
    def storage_provider(self) -> IStorageProvider:
        if not self._storage_provider_created:
            raise RuntimeError(
                "Storage provider not initialized. Use await ConversationSettings.get_storage_provider() "
                "or provide storage_provider in constructor."
            )
        assert (
            self._storage_provider is not None
        ), "Storage provider should be set when _storage_provider_created is True"
        return self._storage_provider

    @storage_provider.setter
    def storage_provider(self, value: IStorageProvider) -> None:
        self._storage_provider = value
        self._storage_provider_created = True

    async def get_storage_provider(self) -> IStorageProvider:
        """Get or create the storage provider asynchronously."""
        if not self._storage_provider_created:
            from ..storage.memorystore import MemoryStorageProvider

            self._storage_provider = await MemoryStorageProvider.create(
                message_text_settings=self.message_text_index_settings,
                related_terms_settings=self.related_term_index_settings,
            )
            self._storage_provider_created = True
        assert (
            self._storage_provider is not None
        ), "Storage provider should be set after creation"
        return self._storage_provider


async def get_time_range_prompt_section_for_conversation[
    TMessage: IMessage, TIndex: ITermToSemanticRefIndex
](
    conversation: IConversation[TMessage, TIndex],
) -> typechat.PromptSection | None:
    time_range = await get_time_range_for_conversation(conversation)
    if time_range is not None:
        start = time_range.start.replace(tzinfo=None).isoformat()
        end = (
            time_range.end.replace(tzinfo=None).isoformat() if time_range.end else "now"
        )
        return typechat.PromptSection(
            role="system",
            content=f"ONLY IF user request explicitly asks for time ranges, "
            f'THEN use the CONVERSATION TIME RANGE: "{start} to {end}"',
        )


async def get_time_range_for_conversation[
    TMessage: IMessage, TIndex: ITermToSemanticRefIndex
](
    conversation: IConversation[TMessage, TIndex],
) -> DateRange | None:
    messages = conversation.messages
    size = await messages.size()
    if size > 0:
        start = (await messages.get_item(0)).timestamp
        if start is not None:
            end = (await messages.get_item(size - 1)).timestamp
            return DateRange(
                start=Datetime.fromisoformat(start),
                end=Datetime.fromisoformat(end) if end else None,
            )
    return None
