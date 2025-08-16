# Test that ConversationSecondaryIndexes now uses storage provider properly
import pytest

from fixtures import needs_auth  # type: ignore  # It's used!
from typeagent.knowpro.secindex import ConversationSecondaryIndexes
from typeagent.knowpro.storage import MemoryStorageProvider


@pytest.mark.asyncio
async def test_conversation_secondary_indexes_uses_storage_provider(needs_auth):
    """Test that ConversationSecondaryIndexes gets indexes from storage provider."""
    storage_provider = MemoryStorageProvider()
    indexes = ConversationSecondaryIndexes(storage_provider)

    # Before initialization, indexes should be None
    assert indexes.property_to_semantic_ref_index is None
    assert indexes.timestamp_index is None
    assert indexes.term_to_related_terms_index is None
    assert indexes.threads is None
    assert indexes.message_index is None

    # After initialization, indexes should be the same ones from storage provider
    await indexes.initialize()

    assert indexes.property_to_semantic_ref_index is not None
    assert indexes.timestamp_index is not None
    assert indexes.term_to_related_terms_index is not None
    assert indexes.threads is not None
    assert indexes.message_index is not None

    # Verify they are the same instances as those from storage provider
    storage_prop_index = await storage_provider.get_property_index()
    storage_timestamp_index = await storage_provider.get_timestamp_index()
    storage_related_terms = await storage_provider.get_related_terms_index()
    storage_threads = await storage_provider.get_conversation_threads()
    storage_message_index = await storage_provider.get_message_text_index()

    assert indexes.property_to_semantic_ref_index is storage_prop_index
    assert indexes.timestamp_index is storage_timestamp_index
    assert indexes.term_to_related_terms_index is storage_related_terms
    assert indexes.threads is storage_threads
    assert indexes.message_index is storage_message_index
