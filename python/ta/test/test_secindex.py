# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import pytest

from fixtures import (
    memory_storage,
    needs_auth,
    embedding_model,
)  # Import the storage fixture
from typeagent.aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
from typeagent.aitools.vectorbase import TextEmbeddingIndexSettings
from typeagent.knowpro.convsettings import ConversationSettings
from typeagent.knowpro.messageindex import MessageTextIndexSettings
from typeagent.knowpro.reltermsindex import RelatedTermIndexSettings
from typeagent.knowpro.interfaces import (
    DeletionInfo,
    IConversation,
    IConversationSecondaryIndexes,
    IMessage,
    IMessageCollection,
    ISemanticRefCollection,
    ITermToSemanticRefIndex,
)
from typeagent.knowpro import kplib
from typeagent.storage.memorystore import MemoryStorageProvider
from typeagent.knowpro.secindex import (
    ConversationSecondaryIndexes,
    build_secondary_indexes,
    build_transient_secondary_indexes,
)
from typeagent.knowpro.collections import (
    MemoryMessageCollection as MemoryMessageCollection,
    MemorySemanticRefCollection,
)

from fixtures import needs_auth  # type: ignore  # Yes it is used!


class SimpleMessage(IMessage):
    """A simple implementation of IMessage for testing purposes."""

    def __init__(self, text: str):
        self.text_chunks: list[str] = [text]
        self.timestamp: str | None = None
        self.tags: list[str] = []
        self.deletion_info: DeletionInfo | None = None

    def get_knowledge(self) -> kplib.KnowledgeResponse:
        raise NotImplementedError


class SimpleConversation(IConversation):
    """A simple implementation of IConversation for testing purposes."""

    settings: ConversationSettings
    name_tag: str
    tags: list[str]
    messages: IMessageCollection[SimpleMessage]
    semantic_refs: ISemanticRefCollection
    semantic_ref_index: ITermToSemanticRefIndex
    secondary_indexes: IConversationSecondaryIndexes[SimpleMessage] | None

    def __init__(self, storage_provider=None):
        self.name_tag = "SimpleConversation"
        self.tags = []
        self.messages = MemoryMessageCollection[SimpleMessage]()
        self.semantic_refs = MemorySemanticRefCollection()
        self.secondary_indexes = None
        # Store settings with storage provider for access via conversation.settings.storage_provider
        if storage_provider is None:
            # Default storage provider will be created lazily in async context
            self._needs_async_init = True
        else:
            # Create test model for settings
            test_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
            self.settings = ConversationSettings(test_model, storage_provider)
            self._needs_async_init = False

    async def ensure_initialized(self):
        """Ensure async initialization is complete."""
        if self._needs_async_init:
            test_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
            self.settings = ConversationSettings(test_model)
            storage_provider = await self.settings.get_storage_provider()
            self.semantic_ref_index = await storage_provider.get_semantic_ref_index()
            self._needs_async_init = False


@pytest.fixture
def simple_conversation() -> SimpleConversation:
    return SimpleConversation()


@pytest.fixture
def conversation_settings(needs_auth: None) -> ConversationSettings:
    from typeagent.aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME

    model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
    return ConversationSettings(model)


def test_conversation_secondary_indexes_initialization(
    memory_storage: MemoryStorageProvider, needs_auth: None
):
    """Test initialization of ConversationSecondaryIndexes."""
    storage_provider = memory_storage
    # Create proper settings for testing
    test_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
    embedding_settings = TextEmbeddingIndexSettings(test_model)
    settings = RelatedTermIndexSettings(embedding_settings)
    indexes = ConversationSecondaryIndexes(storage_provider, settings)
    # Note: indexes are None until initialize() is called
    assert indexes.property_to_semantic_ref_index is None
    assert indexes.timestamp_index is None
    assert indexes.term_to_related_terms_index is None

    # Test with custom settings
    settings2 = RelatedTermIndexSettings(embedding_settings)
    indexes_with_settings = ConversationSecondaryIndexes(storage_provider, settings2)
    assert indexes_with_settings.property_to_semantic_ref_index is None


@pytest.mark.asyncio
async def test_build_secondary_indexes(
    simple_conversation: SimpleConversation, conversation_settings: ConversationSettings
):
    """Test building secondary indexes asynchronously."""
    # Ensure the conversation is properly initialized
    await simple_conversation.ensure_initialized()

    # Add some dummy data to the conversation
    await simple_conversation.messages.append(SimpleMessage("Message 1"))
    await simple_conversation.messages.append(SimpleMessage("Message 2"))

    await build_secondary_indexes(simple_conversation, conversation_settings)

    # Verify that the indexes were built by checking they exist
    assert simple_conversation.secondary_indexes is not None


@pytest.mark.asyncio
async def test_build_transient_secondary_indexes(
    simple_conversation: SimpleConversation, needs_auth: None
):
    """Test building transient secondary indexes."""
    # Ensure the conversation is properly initialized
    await simple_conversation.ensure_initialized()

    # Add some dummy data to the conversation
    await simple_conversation.messages.append(SimpleMessage("Message 1"))
    await simple_conversation.messages.append(SimpleMessage("Message 2"))

    await build_transient_secondary_indexes(
        simple_conversation, simple_conversation.settings
    )

    # Verify that the indexes were built by checking they exist
    assert simple_conversation.secondary_indexes is not None
