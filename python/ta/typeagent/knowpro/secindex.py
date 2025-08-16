# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from .importing import ConversationSettings, RelatedTermIndexSettings
from .interfaces import (
    IConversation,
    IConversationSecondaryIndexes,
    IMessage,
    IStorageProvider,
    ITermToSemanticRefIndex,
    IndexingEventHandlers,
    SecondaryIndexingResults,
    TextIndexingResult,
    TextLocation,
)
from .messageindex import build_message_index
from .propindex import PropertyIndex, build_property_index
from .reltermsindex import RelatedTermsIndex, build_related_terms_index
from .timestampindex import TimestampToTextRangeIndex, build_timestamp_index


class ConversationSecondaryIndexes(IConversationSecondaryIndexes):
    def __init__(
        self,
        storage_provider: IStorageProvider,
        settings: RelatedTermIndexSettings | None = None,
    ):
        self._storage_provider = storage_provider
        # Initialize all indexes through storage provider immediately
        self.property_to_semantic_ref_index = None
        self.timestamp_index = None
        self.term_to_related_terms_index = None
        self.threads = None
        self.message_index = None

    async def initialize(self) -> None:
        """Initialize all indexes from storage provider."""
        self.property_to_semantic_ref_index = (
            await self._storage_provider.get_property_index()
        )
        self.timestamp_index = await self._storage_provider.get_timestamp_index()
        self.term_to_related_terms_index = (
            await self._storage_provider.get_related_terms_index()
        )
        self.threads = await self._storage_provider.get_conversation_threads()
        if self.message_index is None:
            self.message_index = await self._storage_provider.get_message_text_index()


async def build_secondary_indexes[
    TMessage: IMessage,
    TTermToSemanticRefIndex: ITermToSemanticRefIndex,
](
    conversation: IConversation[TMessage, TTermToSemanticRefIndex],
    conversation_settings: ConversationSettings,
    event_handler: IndexingEventHandlers | None,
) -> SecondaryIndexingResults:
    if conversation.secondary_indexes is None:
        # Ensure storage provider is initialized before creating secondary indexes
        await conversation_settings.storage_provider.initialize_indexes()
        conversation.secondary_indexes = ConversationSecondaryIndexes(
            conversation_settings.storage_provider
        )
        await conversation.secondary_indexes.initialize()
    result: SecondaryIndexingResults = await build_transient_secondary_indexes(
        conversation, conversation_settings
    )
    result.related_terms = await build_related_terms_index(
        conversation, conversation_settings, event_handler
    )
    if result.related_terms is not None and not result.related_terms.error:
        res = await build_message_index(
            conversation,
            conversation_settings.message_text_index_settings,
            event_handler,
        )
        result.message = TextIndexingResult(
            completed_upto=TextLocation(message_ordinal=res.number_completed)
        )

    return result


async def build_transient_secondary_indexes[
    TMessage: IMessage, TTermToSemanticRefIndex: ITermToSemanticRefIndex
](
    conversation: IConversation[TMessage, TTermToSemanticRefIndex],
    conversation_settings: ConversationSettings | None = None,
) -> SecondaryIndexingResults:
    if conversation.secondary_indexes is None:
        # Try to get storage provider from conversation.settings first, then from parameter
        storage_provider = None
        if hasattr(conversation, "settings"):
            # Use getattr to avoid type checker issues
            settings = getattr(conversation, "settings", None)
            if settings and hasattr(settings, "storage_provider"):
                storage_provider = settings.storage_provider
        if storage_provider is None and conversation_settings is not None:
            storage_provider = conversation_settings.storage_provider
        if storage_provider is None:
            # Fallback - this shouldn't happen in normal usage
            raise RuntimeError(
                "Cannot create secondary indexes without storage provider"
            )

        conversation.secondary_indexes = ConversationSecondaryIndexes(storage_provider)
        # Ensure storage provider is initialized before initializing secondary indexes
        await storage_provider.initialize_indexes()
        await conversation.secondary_indexes.initialize()
    result = SecondaryIndexingResults()
    result.properties = await build_property_index(conversation)
    result.timestamps = await build_timestamp_index(conversation)
    return result
