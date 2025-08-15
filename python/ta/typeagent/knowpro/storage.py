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

    def __init__(
        self,
        message_text_settings: MessageTextIndexSettings | None = None,
        related_terms_settings: RelatedTermIndexSettings | None = None,
    ):
        # Create all index objects immediately
        self._conversation_index = ConversationIndex()
        self._property_index = PropertyIndex()
        self._timestamp_index = TimestampToTextRangeIndex()

        # Use provided settings or create test-friendly defaults
        if message_text_settings is None:
            from ..aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
            from ..aitools.vectorbase import TextEmbeddingIndexSettings

            test_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
            embedding_settings = TextEmbeddingIndexSettings(test_model)
            message_text_settings = MessageTextIndexSettings(embedding_settings)
        self._message_text_index = MessageTextIndex(message_text_settings)

        if related_terms_settings is None:
            from ..aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
            from ..aitools.vectorbase import TextEmbeddingIndexSettings

            test_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
            embedding_settings = TextEmbeddingIndexSettings(test_model)
            related_terms_settings = RelatedTermIndexSettings(embedding_settings)
        self._related_terms_index = RelatedTermsIndex(related_terms_settings)

        self._conversation_threads = ConversationThreads()

    async def initialize_indexes(self) -> None:
        """Initialize indexes. For memory storage, this is a no-op since indexes are created in __init__."""
        pass

    async def get_conversation_index(self) -> ITermToSemanticRefIndex:
        return self._conversation_index

    async def get_property_index(self) -> IPropertyToSemanticRefIndex:
        return self._property_index

    async def get_timestamp_index(self) -> ITimestampToTextRangeIndex:
        return self._timestamp_index

    async def get_message_text_index(self) -> IMessageTextIndex[TMessage]:
        return self._message_text_index

    async def get_related_terms_index(self) -> ITermToRelatedTermsIndex:
        return self._related_terms_index

    async def get_conversation_threads(self) -> IConversationThreads:
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
