# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
from typing import (
    Any,
    Iterable,
    Iterator,
    Callable,
)

from .collections import (
    MemoryCollection,
    MemoryMessageCollection,
    MemorySemanticRefCollection,
)
from .convindex import ConversationIndex
from .convthreads import ConversationThreads
from .importing import MessageTextIndexSettings, RelatedTermIndexSettings
from .interfaces import (
    IConversationThreads,
    IMessage,
    IMessageTextIndex,
    IPropertyToSemanticRefIndex,
    IStorageProvider,
    ITermToRelatedTermsIndex,
    ITermToSemanticRefIndex,
    ITimestampToTextRangeIndex,
    JsonSerializer,
    MessageOrdinal,
    SemanticRef,
    SemanticRefOrdinal,
)
from .messageindex import MessageTextIndex
from .propindex import PropertyIndex
from .reltermsindex import RelatedTermsIndex
from .timestampindex import TimestampToTextRangeIndex


class MemoryStorageProvider[TMessage: IMessage](IStorageProvider[TMessage]):
    """A storage provider that operates in memory."""

    # Declare indexes as not-None but uninitialized - initialize() must be called
    _conversation_index: ConversationIndex
    _property_index: PropertyIndex
    _timestamp_index: TimestampToTextRangeIndex
    _message_text_index: MessageTextIndex
    _related_terms_index: RelatedTermsIndex
    _conversation_threads: ConversationThreads

    def __init__(
        self,
        message_text_settings: MessageTextIndexSettings,
        related_terms_settings: RelatedTermIndexSettings,
    ):
        # Store settings privately - no defaults, caller must provide
        self._message_text_settings = message_text_settings
        self._related_terms_settings = related_terms_settings
        # Indexes will be created in initialize()

    async def initialize_indexes(self) -> None:
        """Initialize all indexes using the provided settings."""
        self._conversation_index = ConversationIndex()
        self._property_index = PropertyIndex()
        self._timestamp_index = TimestampToTextRangeIndex()
        self._message_text_index = MessageTextIndex(self._message_text_settings)
        self._related_terms_index = RelatedTermsIndex(self._related_terms_settings)
        # Use the same embedding settings for conversation threads
        thread_settings = self._message_text_settings.embedding_index_settings
        self._conversation_threads = ConversationThreads(thread_settings)

    async def get_conversation_index(self) -> ITermToSemanticRefIndex:
        if not hasattr(self, "_conversation_index"):
            await self.initialize_indexes()
        return self._conversation_index

    async def get_property_index(self) -> IPropertyToSemanticRefIndex:
        if not hasattr(self, "_property_index"):
            await self.initialize_indexes()
        return self._property_index

    async def get_timestamp_index(self) -> ITimestampToTextRangeIndex:
        if not hasattr(self, "_timestamp_index"):
            await self.initialize_indexes()
        return self._timestamp_index

    async def get_message_text_index(self) -> IMessageTextIndex[TMessage]:
        if not hasattr(self, "_message_text_index"):
            await self.initialize_indexes()
        return self._message_text_index

    async def get_related_terms_index(self) -> ITermToRelatedTermsIndex:
        if not hasattr(self, "_related_terms_index"):
            await self.initialize_indexes()
        return self._related_terms_index

    async def get_conversation_threads(self) -> IConversationThreads:
        if not hasattr(self, "_conversation_threads"):
            await self.initialize_indexes()
        return self._conversation_threads

    async def create_message_collection(
        self,
        serializer: JsonSerializer[TMessage] | type[TMessage] | None = None,
    ) -> MemoryMessageCollection[TMessage]:
        """Create a new message collection."""
        if isinstance(serializer, JsonSerializer):
            raise ValueError("MemoryStorageProvider does not use a serializer.")
        return MemoryMessageCollection[TMessage]()

    async def create_semantic_ref_collection(self) -> MemorySemanticRefCollection:
        """Create a new semantic reference collection."""
        return MemorySemanticRefCollection()

    async def close(self) -> None:
        """Close the storage provider."""
        pass


# TODO: The rest of this file is not currently used.


@dataclass
class Batch[T]:
    """A batch of items from a collection."""

    start_at: int
    value: list[T]


async def get_batches_from_collection[T](
    collection: MemoryCollection[T, int],
    start_at_ordinal: int,
    batch_size: int,
) -> list[Batch[T]]:
    """Generate batches of items from a collection."""
    start_at = start_at_ordinal
    result = []
    while True:
        batch = await collection.get_slice(start_at, start_at + batch_size)
        if not batch:
            break
        result.append(Batch(start_at=start_at, value=batch))
        start_at += batch_size
    return result


async def map_collection[T](
    collection: MemoryCollection[T, int],
    callback: Callable[[T, int], T],
) -> list[T]:
    """Map a callback function over a collection."""
    results: list[T] = []
    size = await collection.size()
    for i in range(size):
        item = await collection.get_item(i)
        results.append(callback(item, i))
    return results


async def filter_collection[T](
    collection: MemoryCollection[T, int],
    predicate: Callable[[T, int], bool],
) -> list[T]:
    """Filter items in a collection based on a predicate."""
    results: list[T] = []
    size = await collection.size()
    for i in range(size):
        item = await collection.get_item(i)
        if predicate(item, i):
            results.append(item)
    return results
