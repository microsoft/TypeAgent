# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import sqlite3
import typing

from ..knowpro import interfaces
from ..knowpro import serialization
from ..knowpro.semrefindex import TermToSemanticRefIndex, text_range_from_message_chunk
from ..knowpro.propindex import PropertyIndex
from ..knowpro.messageindex import MessageTextIndex, MessageTextIndexSettings
from ..knowpro.reltermsindex import RelatedTermsIndex, RelatedTermIndexSettings
from ..knowpro.convthreads import ConversationThreads


MESSAGES_SCHEMA = """
CREATE TABLE IF NOT EXISTS Messages (
    msg_id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Messages can store chunks directly in JSON or reference external storage via URI
    chunks JSON NULL,             -- JSON array of text chunks, or NULL if using chunk_uri
    chunk_uri TEXT NULL,          -- URI for external chunk storage, or NULL if using chunks
    start_timestamp TEXT NULL,    -- ISO format with Z timezone
    tags JSON NULL,               -- JSON array of tags
    metadata JSON NULL,           -- Message metadata (source, dest, etc.)
    extra JSON NULL               -- Extra message fields that were serialized
);
"""

type ShreddedMessage = tuple[
    str | None, str | None, str | None, str | None, str | None, str | None
]

TIMESTAMP_INDEX_SCHEMA = """
CREATE INDEX IF NOT EXISTS idx_messages_start_timestamp ON Messages(start_timestamp);
"""

SEMANTIC_REFS_SCHEMA = """
CREATE TABLE IF NOT EXISTS SemanticRefs (
    semref_id INTEGER PRIMARY KEY,
    range_json JSON NOT NULL,          -- JSON of the TextRange object
    knowledge_type TEXT NOT NULL,      -- Required to distinguish JSON types (entity, topic, etc.)
    knowledge_json JSON NOT NULL       -- JSON of the Knowledge object
);
"""

type ShreddedSemanticRef = tuple[int, str, str, str]


class SqliteMessageCollection[TMessage: interfaces.IMessage](
    interfaces.IMessageCollection
):
    def __init__(
        self, db: sqlite3.Connection, message_type: type[TMessage] | None = None
    ):
        self.db = db
        self.message_type = message_type

    @property
    def is_persistent(self) -> bool:
        return True

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM Messages")
        return cursor.fetchone()[0]

    def __aiter__(self) -> typing.AsyncIterator[TMessage]:
        return self._async_iterator()

    async def _async_iterator(self) -> typing.AsyncIterator[TMessage]:
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
            FROM Messages ORDER BY msg_id
            """
        )
        for row in cursor:
            message = self._deserialize_message_from_row(row)
            yield message
            # Potentially add await asyncio.sleep(0) here to yield control

    def _deserialize_message_from_row(self, row: ShreddedMessage) -> TMessage:
        """Rehydrate a message from database row columns."""
        (
            chunks_json,
            chunk_uri,
            start_timestamp,
            tags_json,
            metadata_json,
            extra_json,
        ) = row

        # Parse JSON fields and build a JSON object using camelCase.
        message_data = json.loads(extra_json) if extra_json else {}
        message_data["textChunks"] = json.loads(chunks_json) if chunks_json else []
        message_data["timestamp"] = start_timestamp
        message_data["tags"] = json.loads(tags_json) if tags_json else []
        message_data["metadata"] = json.loads(metadata_json) if metadata_json else {}

        # The serialization.deserialize_object will convert to snake_case Python attributes.
        if self.message_type is None:
            raise ValueError(
                "Deserialization requires message_type passed to either get_message_collection or SqliteMessageCollection"
            )
        return serialization.deserialize_object(self.message_type, message_data)

    def _serialize_message_to_row(self, message: TMessage) -> ShreddedMessage:
        """Shred a message object into database columns."""
        # Serialize the message to JSON first (this uses camelCase)
        message_data = serialization.serialize_object(message)

        # Extract shredded fields (JSON uses camelCase)
        chunks_json = json.dumps(message_data.pop("textChunks", []))
        chunk_uri = None  # For now, we're not using chunk URIs
        start_timestamp = message_data.pop("timestamp", None)
        tags_json = json.dumps(message_data.pop("tags", []))
        metadata_json = json.dumps(message_data.pop("metadata", {}))

        # What's left in message_data becomes 'extra'.
        extra_json = json.dumps(message_data) if message_data else None

        return (
            chunks_json,
            chunk_uri,
            start_timestamp,
            tags_json,
            metadata_json,
            extra_json,
        )

    async def get_item(self, arg: int) -> TMessage:
        if not isinstance(arg, int):
            raise TypeError(f"Index must be an int, not {type(arg).__name__}")
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
            FROM Messages WHERE msg_id = ?
        """,
            (arg,),
        )
        row = cursor.fetchone()
        if row:
            return self._deserialize_message_from_row(row)
        raise IndexError("Message not found")

    async def get_slice(self, start: int, stop: int) -> list[TMessage]:
        if stop <= start:
            return []
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT chunks, chunk_uri, start_timestamp, tags, metadata, extra
            FROM Messages WHERE msg_id >= ? AND msg_id < ? ORDER BY msg_id
        """,
            (start, stop),
        )
        rows = cursor.fetchall()
        return [self._deserialize_message_from_row(row) for row in rows]

    async def get_multiple(self, arg: list[int]) -> list[TMessage]:
        results = []
        for i in arg:
            results.append(await self.get_item(i))
        return results

    async def append(self, item: TMessage) -> None:
        with self.db:
            cursor = self.db.cursor()
            (
                chunks_json,
                chunk_uri,
                start_timestamp,
                tags_json,
                metadata_json,
                extra_json,
            ) = self._serialize_message_to_row(item)
            # Use the current size as the ID to maintain 0-based indexing like the old implementation
            msg_id = await self.size()
            cursor.execute(
                """
                INSERT INTO Messages (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    msg_id,
                    chunks_json,
                    chunk_uri,
                    start_timestamp,
                    tags_json,
                    metadata_json,
                    extra_json,
                ),
            )

    async def extend(self, items: typing.Iterable[TMessage]) -> None:
        with self.db:
            cursor = self.db.cursor()
            current_size = await self.size()
            for msg_id, item in enumerate(items, current_size):
                (
                    chunks_json,
                    chunk_uri,
                    start_timestamp,
                    tags_json,
                    metadata_json,
                    extra_json,
                ) = self._serialize_message_to_row(item)
                cursor.execute(
                    """
                    INSERT INTO Messages (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        msg_id,
                        chunks_json,
                        chunk_uri,
                        start_timestamp,
                        tags_json,
                        metadata_json,
                        extra_json,
                    ),
                )


class SqliteSemanticRefCollection(interfaces.ISemanticRefCollection):
    def __init__(self, db: sqlite3.Connection):
        self.db = db

    def _deserialize_semantic_ref_from_row(
        self, row: ShreddedSemanticRef
    ) -> interfaces.SemanticRef:
        """Deserialize a semantic ref from database row columns."""
        semref_id, range_json, knowledge_type, knowledge_json = row

        # Build semantic ref data using camelCase (JSON format)
        semantic_ref_data = interfaces.SemanticRefData(
            semanticRefOrdinal=semref_id,
            range=json.loads(range_json),
            knowledgeType=knowledge_type,  # type: ignore
            knowledge=json.loads(knowledge_json),
        )

        return interfaces.SemanticRef.deserialize(semantic_ref_data)

    def _serialize_semantic_ref_to_row(
        self, semantic_ref: interfaces.SemanticRef
    ) -> ShreddedSemanticRef:
        """Serialize a semantic ref object into database columns."""
        # Serialize the semantic ref to JSON first (this uses camelCase)
        semantic_ref_data = semantic_ref.serialize()

        # Extract shredded fields (JSON uses camelCase)
        semref_id = semantic_ref_data["semanticRefOrdinal"]
        range_json = json.dumps(semantic_ref_data["range"])
        knowledge_type = semantic_ref_data["knowledgeType"]
        knowledge_json = json.dumps(semantic_ref_data["knowledge"])

        return (semref_id, range_json, knowledge_type, knowledge_json)

    @property
    def is_persistent(self) -> bool:
        return True

    async def size(self) -> int:
        return self._size()

    def _size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM SemanticRefs")
        return cursor.fetchone()[0]

    async def __aiter__(self) -> typing.AsyncIterator[interfaces.SemanticRef]:
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT semref_id, range_json, knowledge_type, knowledge_json 
            FROM SemanticRefs ORDER BY semref_id
        """
        )
        for row in cursor:
            yield self._deserialize_semantic_ref_from_row(row)

    async def get_item(self, arg: int) -> interfaces.SemanticRef:
        if not isinstance(arg, int):
            raise TypeError(f"Index must be an int, not {type(arg).__name__}")
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT semref_id, range_json, knowledge_type, knowledge_json 
            FROM SemanticRefs WHERE semref_id = ?
        """,
            (arg,),
        )
        row = cursor.fetchone()
        if row:
            return self._deserialize_semantic_ref_from_row(row)
        raise IndexError("SemanticRef not found")

    async def get_slice(self, start: int, stop: int) -> list[interfaces.SemanticRef]:
        if stop <= start:
            return []
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT semref_id, range_json, knowledge_type, knowledge_json 
            FROM SemanticRefs WHERE semref_id >= ? AND semref_id < ? 
            ORDER BY semref_id
        """,
            (start, stop),
        )
        rows = cursor.fetchall()
        return [self._deserialize_semantic_ref_from_row(row) for row in rows]

    async def get_multiple(self, arg: list[int]) -> list[interfaces.SemanticRef]:
        # TODO: Do we really want to support this?
        # If so, we should probably try to optimize it.
        results = []
        for i in arg:
            results.append(await self.get_item(i))
        return results

    async def append(self, item: interfaces.SemanticRef) -> None:
        with self.db:
            cursor = self.db.cursor()
            semref_id, range_json, knowledge_type, knowledge_json = (
                self._serialize_semantic_ref_to_row(item)
            )
            cursor.execute(
                """
                INSERT INTO SemanticRefs (semref_id, range_json, knowledge_type, knowledge_json) 
                VALUES (?, ?, ?, ?)
            """,
                (semref_id, range_json, knowledge_type, knowledge_json),
            )

    async def extend(self, items: typing.Iterable[interfaces.SemanticRef]) -> None:
        with self.db:
            cursor = self.db.cursor()
            for item in items:
                semref_id, range_json, knowledge_type, knowledge_json = (
                    self._serialize_semantic_ref_to_row(item)
                )
                cursor.execute(
                    """
                    INSERT INTO SemanticRefs (semref_id, range_json, knowledge_type, knowledge_json) 
                    VALUES (?, ?, ?, ?)
                """,
                    (semref_id, range_json, knowledge_type, knowledge_json),
                )


class SqliteStorageProvider[TMessage: interfaces.IMessage](
    interfaces.IStorageProvider[TMessage]
):
    """A storage provider backed by SQLite.

    NOTE: You can create only one message collection
    and one semantic ref collection per provider.
    For now, indexes are stored in memory (not persisted to SQLite).
    """

    db_path: str
    message_type: type[TMessage]
    db: sqlite3.Connection | None

    _message_collection: SqliteMessageCollection[TMessage]
    _semantic_ref_collection: SqliteSemanticRefCollection
    _conversation_index: TermToSemanticRefIndex
    _property_index: PropertyIndex
    _timestamp_index: interfaces.ITimestampToTextRangeIndex
    _message_text_index: interfaces.IMessageTextIndex[TMessage]
    _related_terms_index: RelatedTermsIndex
    _conversation_threads: ConversationThreads

    def __init__(self, db_path: str, message_type: type[TMessage]):
        self.db_path = db_path
        self.message_type = message_type

    @classmethod
    async def create(
        cls,
        message_text_settings: MessageTextIndexSettings,
        related_terms_settings: RelatedTermIndexSettings,
        db_path: str,
        message_type: type[TMessage],
    ) -> "SqliteStorageProvider[TMessage]":
        """Create and initialize a SqliteStorageProvider with all indexes."""
        self = cls(db_path, message_type)

        # Initialize database connection first
        self.db = self._create_db(self.db_path)

        # Initialize collections
        self._message_collection = SqliteMessageCollection(self.db, message_type)
        self._semantic_ref_collection = SqliteSemanticRefCollection(self.db)

        # Initialize all indexes
        self._conversation_index = TermToSemanticRefIndex()
        self._property_index = PropertyIndex()
        self._timestamp_index = SqliteTimestampToTextRangeIndex(self.db)
        self._message_text_index = MessageTextIndex(message_text_settings)
        self._related_terms_index = RelatedTermsIndex(related_terms_settings)
        self._conversation_threads = ConversationThreads(
            related_terms_settings.embedding_index_settings
        )

        # Populate indexes from existing data
        msg_size = await self._message_collection.size()
        semref_size = await self._semantic_ref_collection.size()
        if msg_size or semref_size:
            await self._populate_indexes_from_data()

        return self

    async def _populate_indexes_from_data(self) -> None:
        """Populate in-memory indexes from persisted data."""
        from ..knowpro.semrefindex import add_facet
        from ..knowpro import kplib
        from ..knowpro.propindex import (
            add_entity_properties_to_index,
            add_action_properties_to_index,
        )

        # Build conversation index and property index from semantic refs
        semref_size = await self._semantic_ref_collection.size()
        sem_refs = await self._semantic_ref_collection.get_slice(0, semref_size)
        for sem_ref in sem_refs:
            knowledge = sem_ref.knowledge
            ref_ordinal = sem_ref.semantic_ref_ordinal

            if isinstance(knowledge, kplib.ConcreteEntity):
                # Add to conversation index
                await self._conversation_index.add_term(knowledge.name, ref_ordinal)
                for type_name in knowledge.type:
                    await self._conversation_index.add_term(type_name, ref_ordinal)
                if knowledge.facets:
                    for facet in knowledge.facets:
                        await add_facet(facet, ref_ordinal, self._conversation_index)

                # Add to property index
                await add_entity_properties_to_index(
                    knowledge, self._property_index, ref_ordinal
                )

            elif isinstance(knowledge, interfaces.Topic):
                # Add to conversation index (topics not in property index per TypeScript)
                await self._conversation_index.add_term(knowledge.text, ref_ordinal)

            elif isinstance(knowledge, kplib.Action):
                # Add to conversation index
                await self._conversation_index.add_term(
                    " ".join(knowledge.verbs), ref_ordinal
                )
                if knowledge.subject_entity_name != "none":
                    await self._conversation_index.add_term(
                        knowledge.subject_entity_name, ref_ordinal
                    )
                if knowledge.object_entity_name != "none":
                    await self._conversation_index.add_term(
                        knowledge.object_entity_name, ref_ordinal
                    )
                if knowledge.indirect_object_entity_name != "none":
                    await self._conversation_index.add_term(
                        knowledge.indirect_object_entity_name, ref_ordinal
                    )
                if knowledge.params:
                    for param in knowledge.params:
                        if isinstance(param, str):
                            await self._conversation_index.add_term(param, ref_ordinal)
                        else:
                            await self._conversation_index.add_term(
                                param.name, ref_ordinal
                            )
                            if hasattr(param, "value") and isinstance(param.value, str):
                                await self._conversation_index.add_term(
                                    param.value, ref_ordinal
                                )
                if (
                    hasattr(knowledge, "subject_entity_facet")
                    and knowledge.subject_entity_facet
                ):
                    await add_facet(
                        knowledge.subject_entity_facet,
                        ref_ordinal,
                        self._conversation_index,
                    )

                # Add to property index
                await add_action_properties_to_index(
                    knowledge, self._property_index, ref_ordinal
                )

            elif isinstance(knowledge, interfaces.Tag):
                # Add to conversation index
                await self._conversation_index.add_term(knowledge.text, ref_ordinal)

                # Add to property index
                await self._property_index.add_property(
                    "tag", knowledge.text, ref_ordinal
                )

        # Build timestamp index from messages
        msg_count = await self._message_collection.size()
        for i in range(msg_count):
            message = await self._message_collection.get_item(i)
            if message.timestamp:
                await self._timestamp_index.add_timestamp(i, message.timestamp)

        # Build message text index from messages
        if msg_count > 0:
            # Get all messages for batch processing
            messages = []
            for message in await self._message_collection.get_slice(0, msg_count):
                messages.append(message)

            # Add all messages to the message text index
            await self._message_text_index.add_messages(messages)

        # Build related terms index from semantic ref index terms
        # Get all terms from the conversation index and add them to the fuzzy index
        all_terms = await self._conversation_index.get_terms()
        if all_terms:
            fuzzy_index = self._related_terms_index.fuzzy_index
            if fuzzy_index is not None:
                await fuzzy_index.add_terms(all_terms)

    async def close(self) -> None:
        if self.db is not None:
            self.db.close()
            self.db = None

    def _create_db(self, db_path: str) -> sqlite3.Connection:
        db = sqlite3.connect(db_path)
        with db:
            db.execute(MESSAGES_SCHEMA)
            db.execute(TIMESTAMP_INDEX_SCHEMA)
            db.execute(SEMANTIC_REFS_SCHEMA)
        return db

    # Collection getter methods

    async def get_message_collection(self) -> SqliteMessageCollection[TMessage]:
        return self._message_collection

    async def get_semantic_ref_collection(self) -> interfaces.ISemanticRefCollection:
        return self._semantic_ref_collection

    # Index getter methods

    async def get_semantic_ref_index(self) -> interfaces.ITermToSemanticRefIndex:
        return self._conversation_index

    async def get_property_index(self) -> interfaces.IPropertyToSemanticRefIndex:
        return self._property_index

    async def get_timestamp_index(self) -> interfaces.ITimestampToTextRangeIndex:
        return self._timestamp_index

    async def get_message_text_index(self) -> interfaces.IMessageTextIndex[TMessage]:
        return self._message_text_index

    async def get_related_terms_index(self) -> interfaces.ITermToRelatedTermsIndex:
        return self._related_terms_index

    async def get_conversation_threads(self) -> interfaces.IConversationThreads:
        return self._conversation_threads


class SqliteTimestampToTextRangeIndex(interfaces.ITimestampToTextRangeIndex):
    """SQL-based timestamp index that queries Messages table directly."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def size(self):
        return self._size()

    def _size(self):
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM Messages WHERE start_timestamp IS NOT NULL"
        )
        return cursor.fetchone()[0]

    async def add_timestamp(
        self, message_ordinal: interfaces.MessageOrdinal, timestamp: str
    ) -> bool:
        return self._add_timestamp(message_ordinal, timestamp)

    def _add_timestamp(
        self, message_ordinal: interfaces.MessageOrdinal, timestamp: str
    ) -> bool:
        """Add timestamp to Messages table start_timestamp column."""
        if not timestamp:
            return False

        # Normalize timestamp format for consistency
        from datetime import datetime

        try:
            timestamp_datetime = datetime.fromisoformat(timestamp)
            normalized_timestamp = timestamp_datetime.isoformat()
        except ValueError:
            return False

        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                "UPDATE Messages SET start_timestamp = ? WHERE msg_id = ?",
                (normalized_timestamp, message_ordinal),
            )
        return cursor.rowcount > 0

    async def add_timestamps(
        self, message_timestamps: list[tuple[interfaces.MessageOrdinal, str]]
    ) -> None:
        return self._add_timestamps(message_timestamps)

    def _add_timestamps(
        self, message_timestamps: list[tuple[interfaces.MessageOrdinal, str]]
    ) -> None:
        """Add multiple timestamps to Messages table."""
        from datetime import datetime

        with self.db:
            cursor = self.db.cursor()
            # Normalize timestamps and filter out empty/invalid ones
            updates = []
            for message_ordinal, timestamp in message_timestamps:
                if timestamp:
                    try:
                        timestamp_datetime = datetime.fromisoformat(timestamp)
                        normalized_timestamp = timestamp_datetime.isoformat()
                        updates.append((normalized_timestamp, message_ordinal))
                    except ValueError:
                        continue  # Skip invalid timestamps

            cursor.executemany(
                "UPDATE Messages SET start_timestamp = ? WHERE msg_id = ?", updates
            )

    async def lookup_range(
        self, date_range: interfaces.DateRange
    ) -> list[interfaces.TimestampedTextRange]:
        return self._lookup_range(date_range)

    def _lookup_range(
        self, date_range: interfaces.DateRange
    ) -> list[interfaces.TimestampedTextRange]:
        """Look up timestamped text ranges in the given date range."""
        start_timestamp = date_range.start.isoformat()

        cursor = self.db.cursor()

        if date_range.end is None:
            # Point query - find messages exactly at start time
            cursor.execute(
                "SELECT msg_id, start_timestamp FROM Messages WHERE start_timestamp = ? ORDER BY start_timestamp",
                (start_timestamp,),
            )
        else:
            # Range query - start <= timestamp < end (end exclusive)
            end_timestamp = date_range.end.isoformat()
            cursor.execute(
                "SELECT msg_id, start_timestamp FROM Messages "
                "WHERE start_timestamp >= ? AND start_timestamp < ? "
                "ORDER BY start_timestamp",
                (start_timestamp, end_timestamp),
            )

        results = []
        for msg_id, timestamp in cursor.fetchall():
            message_ordinal = msg_id  # msg_id is 0-based like message_ordinal
            text_range = text_range_from_message_chunk(message_ordinal)
            results.append(
                interfaces.TimestampedTextRange(timestamp=timestamp, range=text_range)
            )

        return results
