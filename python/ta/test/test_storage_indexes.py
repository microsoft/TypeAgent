# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import pytest

from fixtures import needs_auth  # type: ignore  # It's used!
from typeagent.knowpro.storage import MemoryStorageProvider


@pytest.mark.asyncio
async def test_all_index_creation(needs_auth):
    """Test that all 6 index types are created and accessible."""
    storage = MemoryStorageProvider()

    # Initialize indexes
    await storage.initialize_indexes()

    # Test all index types are created and return objects
    conv_index = await storage.get_conversation_index()
    assert conv_index is not None

    prop_index = await storage.get_property_index()
    assert prop_index is not None

    time_index = await storage.get_timestamp_index()
    assert time_index is not None

    msg_index = await storage.get_message_text_index()
    assert msg_index is not None

    rel_index = await storage.get_related_terms_index()
    assert rel_index is not None

    threads = await storage.get_conversation_threads()
    assert threads is not None


@pytest.mark.asyncio
async def test_index_persistence(needs_auth):
    """Test that same index instance is returned across calls."""
    storage = MemoryStorageProvider()
    await storage.initialize_indexes()

    # All index types should return same instance across calls
    conv1 = await storage.get_conversation_index()
    conv2 = await storage.get_conversation_index()
    assert conv1 is conv2

    prop1 = await storage.get_property_index()
    prop2 = await storage.get_property_index()
    assert prop1 is prop2


@pytest.mark.asyncio
async def test_indexes_work_independently(needs_auth):
    """Test that different storage providers have independent indexes."""
    storage1 = MemoryStorageProvider()
    storage2 = MemoryStorageProvider()

    await storage1.initialize_indexes()
    await storage2.initialize_indexes()

    # Get indexes from both storage providers
    index1 = await storage1.get_conversation_index()
    index2 = await storage2.get_conversation_index()

    # Should be different instances
    assert index1 is not index2


@pytest.mark.asyncio
async def test_initialize_indexes_is_idempotent(needs_auth):
    """Test that initialize_indexes can be called multiple times safely."""
    storage = MemoryStorageProvider()

    # Call initialize multiple times
    await storage.initialize_indexes()
    await storage.initialize_indexes()
    await storage.initialize_indexes()

    # Should still work
    conv_index = await storage.get_conversation_index()
    assert conv_index is not None


@pytest.mark.asyncio
async def test_indexes_available_without_explicit_initialize(needs_auth):
    """Test that indexes are available even without calling initialize_indexes (for backward compatibility)."""
    storage = MemoryStorageProvider()

    # Should work without explicit initialize call
    conv_index = await storage.get_conversation_index()
    assert conv_index is not None


@pytest.mark.asyncio
async def test_storage_provider_collections_still_work(needs_auth):
    """Test that existing collection functionality still works."""
    storage = MemoryStorageProvider()

    # Test message collection creation
    msg_collection = await storage.create_message_collection()
    assert msg_collection is not None
    assert await msg_collection.size() == 0

    # Test semantic ref collection creation
    ref_collection = await storage.create_semantic_ref_collection()
    assert ref_collection is not None
    assert await ref_collection.size() == 0
