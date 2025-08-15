# Storage Provider Index Centralization - Immediate Implementation Steps

## Overview

This specification outlines the immediate implementation steps needed before updating the SQLite storage provider schema. The focus is on centralizing index creation and management within the storage provider interface, which will make the subsequent SQLite implementation much cleaner.

## Current State Analysis

### Index Types and Current Implementations

Based on code analysis, we have **7 index implementations** in `IConversationSecondaryIndexes`:

1. **ConversationIndex** (`convindex.py`):
   - Type: `ITermToSemanticRefIndex`
   - Storage: `_map: dict[str, list[ScoredSemanticRefOrdinal]]`
   - Creates: Term → SemanticRef mappings for entities, topics, actions

2. **PropertyIndex** (`propindex.py`):
   - Type: `IPropertyToSemanticRefIndex`
   - Storage: `_map: dict[str, list[ScoredSemanticRefOrdinal]]`
   - Creates: Property name → SemanticRef mappings

3. **TimestampToTextRangeIndex** (`timestampindex.py`):
   - Type: `ITimestampToTextRangeIndex`
   - Storage: `_ranges: list[TimestampedTextRange]` (sorted by timestamp)
   - Creates: Timestamp → TextRange mappings
   - **SQLite Note**: In SQLite implementation, this will be replaced by direct queries on Messages table using `start_timestamp`/`end_timestamp` columns

4. **MessageTextIndex** (`messageindex.py`):
   - Type: `IMessageTextEmbeddingIndex`
   - Storage: `TextToTextLocationIndex` (embeddings)
   - Creates: Message text → MessageOrdinal mappings

5. **RelatedTermsIndex** (`reltermsindex.py`):
   - Type: `ITermToRelatedTermsIndex`
   - Storage: `_alias_map` + `_term_index` (embeddings)
   - Creates: Term → Related terms mappings
   - **SQLite Note**: In SQLite implementation, this will be split into two tables - `RelatedTermsAliases` for exact aliases and `RelatedTermsFuzzy` for conversation-derived fuzzy matches

6. **ConversationThreads** (`convthreads.py`):
   - Type: `IConversationThreads`
   - Storage: `threads: list[Thread]` + `vector_base: VectorBase`
   - Creates: Thread description → Thread mappings

7. **EmbeddingIndex** (`fuzzyindex.py`):
   - Type: Custom wrapper around `VectorBase`
   - Storage: NumPy arrays via VectorBase
   - Creates: Text embedding vectors for fuzzy search
   - Note: Used internally by RelatedTermsIndex and MessageTextIndex

### Current Index Creation Pattern

Index creation is currently **scattered** across multiple files:

- `secindex.py`: `ConversationSecondaryIndexes` class coordinates some indexes
- `convindex.py`: Functions like `build_conversation_index()`, `build_semantic_ref_index()`
- `timestampindex.py`: `build_timestamp_index()`
- `messageindex.py`: Index creation within `MessageTextIndex.add_messages()`
- Individual index classes have their own `add_*()` methods

This scattered approach makes it difficult to:
- Track which indexes exist for a conversation
- Ensure consistent index creation
- Migrate to SQLite storage cleanly

## Step 0: Prepare Development Environment ✓

Following the Python coding guidelines:

- **Testing**: Use `pytest`, `assert` statements, minimal mocking
- **Type checking**: Use `pyright` (or Pylance in VS Code)
- **Commands**:
  - `make test` - run all tests
  - `make check` - type-check all files
  - `make format` - reformat with black
- **Environment**: Activate `.venv`, use `make clean venv` if needed

## Step 1: Centralize Index Creation in Storage Provider

### 1.1 Extend IStorageProvider Interface

Add index management methods to `interfaces.py`:

```python
class IStorageProvider[TMessage: IMessage](Protocol):
    # ... existing methods ...

    # Index management - ALL 7 index types
    async def get_conversation_index(
        self, conversation_id: str
    ) -> ITermToSemanticRefIndex: ...

    async def get_property_index(
        self, conversation_id: str
    ) -> IPropertyToSemanticRefIndex: ...

    async def get_timestamp_index(
        self, conversation_id: str
    ) -> ITimestampToTextRangeIndex: ...

    async def get_message_text_index(
        self, conversation_id: str
    ) -> IMessageTextIndex[TMessage]: ...

    async def get_related_terms_index(
        self, conversation_id: str
    ) -> ITermToRelatedTermsIndex: ...

    async def get_conversation_threads(
        self, conversation_id: str
    ) -> IConversationThreads: ...

    # EmbeddingIndex is used internally by other indexes, not exposed directly

    # Index lifecycle
    async def create_indexes_for_conversation(
        self, conversation_id: str
    ) -> None: ...

    async def drop_indexes_for_conversation(
        self, conversation_id: str
    ) -> None: ...
```

### 1.2 Update MemoryStorageProvider

Modify `storage.py` to implement index management:

```python
class MemoryStorageProvider[TMessage: IMessage](IStorageProvider[TMessage]):
    def __init__(self):
        # ... existing init ...
        self._conversation_indexes: dict[str, ConversationIndex] = {}
        self._property_indexes: dict[str, PropertyIndex] = {}
        self._timestamp_indexes: dict[str, TimestampToTextRangeIndex] = {}
        self._message_text_indexes: dict[str, MessageTextIndex] = {}
        self._related_terms_indexes: dict[str, RelatedTermsIndex] = {}
        self._conversation_threads: dict[str, ConversationThreads] = {}

    async def get_conversation_index(
        self, conversation_id: str
    ) -> ITermToSemanticRefIndex:
        if conversation_id not in self._conversation_indexes:
            self._conversation_indexes[conversation_id] = ConversationIndex()
        return self._conversation_indexes[conversation_id]

    async def get_related_terms_index(
        self, conversation_id: str
    ) -> ITermToRelatedTermsIndex:
        if conversation_id not in self._related_terms_indexes:
            # Use default settings for now
            from .reltermsindex import RelatedTermsIndex, RelatedTermIndexSettings
            settings = RelatedTermIndexSettings()
            self._related_terms_indexes[conversation_id] = RelatedTermsIndex(settings)
        return self._related_terms_indexes[conversation_id]

    async def get_conversation_threads(
        self, conversation_id: str
    ) -> IConversationThreads:
        if conversation_id not in self._conversation_threads:
            self._conversation_threads[conversation_id] = ConversationThreads()
        return self._conversation_threads[conversation_id]

    # ... similar methods for other index types ...

    async def create_indexes_for_conversation(
        self, conversation_id: str
    ) -> None:
        # Ensure all indexes exist for this conversation
        await self.get_conversation_index(conversation_id)
        await self.get_property_index(conversation_id)
        await self.get_timestamp_index(conversation_id)
        await self.get_message_text_index(conversation_id)
        await self.get_related_terms_index(conversation_id)
        await self.get_conversation_threads(conversation_id)

    async def drop_indexes_for_conversation(
        self, conversation_id: str
    ) -> None:
        self._conversation_indexes.pop(conversation_id, None)
        self._property_indexes.pop(conversation_id, None)
        self._timestamp_indexes.pop(conversation_id, None)
        self._message_text_indexes.pop(conversation_id, None)
        self._related_terms_indexes.pop(conversation_id, None)
        self._conversation_threads.pop(conversation_id, None)
```

### 1.3 Keep Existing Index Creation Methods, Route Through Storage Provider

**Key Change**: Instead of moving the index creation logic, we'll **keep the existing methods** in their current files but **update them to use storage provider indexes**.

#### Update ConversationSecondaryIndexes Class

Modify `secindex.py` to get indexes from storage provider:

```python
class ConversationSecondaryIndexes[TMessage: IMessage](IConversationSecondaryIndexes[TMessage]):
    def __init__(self, storage_provider: IStorageProvider[TMessage], conversation_id: str):
        self._storage_provider = storage_provider
        self._conversation_id = conversation_id
        # Initialize all indexes through storage provider
        self._property_index: IPropertyToSemanticRefIndex | None = None
        self._timestamp_index: ITimestampToTextRangeIndex | None = None
        self._related_terms_index: ITermToRelatedTermsIndex | None = None
        self._threads: IConversationThreads | None = None
        self._message_index: IMessageTextIndex[TMessage] | None = None

    @property
    async def property_to_semantic_ref_index(self) -> IPropertyToSemanticRefIndex | None:
        if self._property_index is None:
            self._property_index = await self._storage_provider.get_property_index(self._conversation_id)
        return self._property_index

    @property
    async def timestamp_index(self) -> ITimestampToTextRangeIndex | None:
        if self._timestamp_index is None:
            self._timestamp_index = await self._storage_provider.get_timestamp_index(self._conversation_id)
        return self._timestamp_index

    # ... similar async properties for other indexes ...
```

#### Update Index Building Functions

Modify existing functions to use storage provider indexes:

```python
# In convindex.py
async def build_conversation_index[TMessage: IMessage](
    conversation: IConversation[TMessage, ConversationIndex],
    conversation_settings: importing.ConversationSettings,
    event_handler: IndexingEventHandlers | None = None,
) -> IndexingResults:
    # Get indexes from storage provider instead of conversation properties
    storage_provider = conversation.storage_provider
    conversation_index = await storage_provider.get_conversation_index(conversation.conversation_id)

    # Keep existing building logic, just use storage provider index
    result = IndexingResults()
    result.semantic_refs = await build_semantic_ref_index(
        conversation,
        conversation_settings.semantic_ref_index_settings,
        event_handler,
    )
    # ... rest of building logic stays the same ...

# In timestampindex.py
async def build_timestamp_index(conversation: IConversation) -> ListIndexingResult:
    if conversation.messages:
        # Get timestamp index from storage provider
        storage_provider = conversation.storage_provider
        timestamp_index = await storage_provider.get_timestamp_index(conversation.conversation_id)

        # Use existing logic with storage provider index
        return await add_to_timestamp_index(
            timestamp_index,
            conversation.messages,
            0,
        )
    return ListIndexingResult(0)

# Similar updates for other index building functions...
```

## Step 2: Update Tests

### 2.1 Test Index Centralization

Create tests for the new storage provider index methods:

```python
# In test/test_storage_indexes.py
import pytest
from typeagent.knowpro.storage import MemoryStorageProvider
from typeagent.knowpro.interfaces import (
    ITermToSemanticRefIndex, IPropertyToSemanticRefIndex,
    ITimestampToTextRangeIndex, IMessageTextIndex,
    ITermToRelatedTermsIndex, IConversationThreads
)

@pytest.mark.asyncio
async def test_all_index_creation():
    """Test that all 7 index types are created lazily."""
    storage = MemoryStorageProvider()

    # Test all index types
    conv_index = await storage.get_conversation_index("conv1")
    assert isinstance(conv_index, ITermToSemanticRefIndex)

    prop_index = await storage.get_property_index("conv1")
    assert isinstance(prop_index, IPropertyToSemanticRefIndex)

    time_index = await storage.get_timestamp_index("conv1")
    assert isinstance(time_index, ITimestampToTextRangeIndex)

    msg_index = await storage.get_message_text_index("conv1")
    assert isinstance(msg_index, IMessageTextIndex)

    rel_index = await storage.get_related_terms_index("conv1")
    assert isinstance(rel_index, ITermToRelatedTermsIndex)

    threads = await storage.get_conversation_threads("conv1")
    assert isinstance(threads, IConversationThreads)

@pytest.mark.asyncio
async def test_index_isolation():
    """Test that indexes are isolated per conversation."""
    storage = MemoryStorageProvider()

    index1 = await storage.get_conversation_index("conv1")
    index2 = await storage.get_conversation_index("conv2")

    assert index1 is not index2

    # Add term to one index
    index1.add_term("test", 0)

    # Should not appear in other index
    assert len(index2.lookup_term("test")) == 0

@pytest.mark.asyncio
async def test_index_persistence_per_conversation():
    """Test that same index instance is returned for same conversation."""
    storage = MemoryStorageProvider()

    # All index types should return same instance for same conversation
    conv1_1 = await storage.get_conversation_index("conv1")
    conv1_2 = await storage.get_conversation_index("conv1")
    assert conv1_1 is conv1_2

    prop1_1 = await storage.get_property_index("conv1")
    prop1_2 = await storage.get_property_index("conv1")
    assert prop1_1 is prop1_2

@pytest.mark.asyncio
async def test_drop_indexes():
    """Test that dropping indexes cleans up properly."""
    storage = MemoryStorageProvider()

    # Create all index types
    await storage.get_conversation_index("conv1")
    await storage.get_property_index("conv1")
    await storage.get_timestamp_index("conv1")
    await storage.get_message_text_index("conv1")
    await storage.get_related_terms_index("conv1")
    await storage.get_conversation_threads("conv1")

    # Drop them
    await storage.drop_indexes_for_conversation("conv1")

    # New indexes should be created on next access
    new_conv_index = await storage.get_conversation_index("conv1")
    assert len(new_conv_index) == 0
```

### 2.2 Update Existing Tests

Update tests that currently access `conversation.semantic_ref_index` to use the new methods:

```python
# Before:
# index = conversation.semantic_ref_index

# After:
index = await conversation.get_conversation_index()
```

## Step 3: Migration Strategy

### 3.1 Backward Compatibility

To avoid breaking existing code during transition:

1. Keep old conversation properties but mark them deprecated
2. Implement them as wrappers around storage provider methods
3. Add deprecation warnings
4. Remove in later phase

### 3.2 Gradual Migration

1. **Phase 1**: Add new storage provider methods alongside existing code
2. **Phase 2**: Update index building functions to use new methods
3. **Phase 3**: Update all tests and calling code
4. **Phase 4**: Remove deprecated conversation properties

## Benefits of This Approach

1. **Centralized Management**: All index creation happens in one place
2. **Clear Ownership**: Storage provider owns all persistent data including indexes
3. **Easier Testing**: Index creation and lifecycle can be tested independently
4. **SQLite Preparation**: Storage provider interface already handles index persistence
5. **Type Safety**: Clear interfaces for each index type

## Implementation Order

1. Extend `IStorageProvider` interface (30 min)
2. Update `MemoryStorageProvider` implementation (1 hour)
3. Update index building functions (1 hour)
4. Write comprehensive tests (1 hour)
5. Update existing tests that break (30 min)
6. Remove `ConversationSecondaryIndexes` class (30 min)

**Total estimated time: 4.5 hours**

## Success Criteria

After this step is complete:

- All index creation goes through `IStorageProvider` methods
- Tests pass with new centralized approach
- No direct access to conversation index properties in new code
- Clear path to SQLite implementation (storage provider manages all persistence)
- Existing functionality unchanged (backward compatibility maintained)

This centralization makes the subsequent SQLite implementation much simpler, since the storage provider interface already handles all index management.
