# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import sqlite3
import typing

from ..knowpro import interfaces
from ..knowpro import serialization
from ..knowpro.semrefindex import TermToSemanticRefIndex
from ..knowpro.propindex import PropertyIndex
from ..knowpro.timestampindex import TimestampToTextRangeIndex
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

MESSAGES_INDEX_SCHEMA = """
CREATE INDEX IF NOT EXISTS idx_messages_start_timestamp ON Messages(start_timestamp);
"""

SEMANTIC_REFS_SCHEMA = """
CREATE TABLE IF NOT EXISTS SemanticRefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    srdata TEXT NOT NULL
);
"""


class SqliteMessageCollection[TMessage: interfaces.IMessage](
    interfaces.IMessageCollection
):
    def __init__(self, db: sqlite3.Connection, message_type: type[TMessage]):
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
            message = self._rehydrate_message_from_row(row)
            yield message
            # Potentially add await asyncio.sleep(0) here to yield control

    def _rehydrate_message_from_row(self, row: tuple) -> TMessage:
        """Rehydrate a message from database row columns."""
        (
            chunks_json,
            chunk_uri,
            start_timestamp,
            tags_json,
            metadata_json,
            extra_json,
        ) = row

        # Parse JSON fields
        tags = json.loads(tags_json) if tags_json else []
        metadata = json.loads(metadata_json) if metadata_json else {}
        extra = json.loads(extra_json) if extra_json else {}
        text_chunks = json.loads(chunks_json) if chunks_json else []

        # Build message object using camelCase (JSON format)
        # The serialization.deserialize_object will convert to snake_case Python attributes
        message_data = {
            "textChunks": text_chunks,
            "tags": tags,
            "timestamp": start_timestamp,
            "metadata": metadata,
            **extra,  # Include any additional fields from extra JSON
        }

        return serialization.deserialize_object(self.message_type, message_data)

    def _shred_message_to_columns(self, item: TMessage) -> tuple:
        """Shred a message object into database columns."""
        # Serialize the message to JSON first (this uses camelCase)
        json_obj = serialization.serialize_object(item)

        # Extract shredded fields (JSON uses camelCase)
        chunks = json.dumps(json_obj.get("textChunks", []))
        chunk_uri = None  # For now, we're not using chunk URIs
        start_timestamp = json_obj.get("timestamp")
        tags = json.dumps(json_obj.get("tags", []))
        metadata = json.dumps(json_obj.get("metadata", {}))

        # Put remaining fields in extra JSON
        excluded_keys = {"textChunks", "timestamp", "tags", "metadata"}
        extra_fields = {k: v for k, v in json_obj.items() if k not in excluded_keys}
        extra = json.dumps(extra_fields) if extra_fields else None

        return chunks, chunk_uri, start_timestamp, tags, metadata, extra

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
            return self._rehydrate_message_from_row(row)
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
        return [self._rehydrate_message_from_row(row) for row in rows]

    async def get_multiple(self, arg: list[int]) -> list[TMessage]:
        results = []
        for i in arg:
            results.append(await self.get_item(i))
        return results

    async def append(self, item: TMessage) -> None:
        cursor = self.db.cursor()
        chunks, chunk_uri, start_timestamp, tags, metadata, extra = (
            self._shred_message_to_columns(item)
        )
        # Use the current size as the ID to maintain 0-based indexing like the old implementation
        msg_id = await self.size()
        cursor.execute(
            """
            INSERT INTO Messages (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra),
        )
        self.db.commit()

    async def extend(self, items: typing.Iterable[TMessage]) -> None:
        cursor = self.db.cursor()
        current_size = await self.size()
        for msg_id, item in enumerate(items, current_size):
            chunks, chunk_uri, start_timestamp, tags, metadata, extra = (
                self._shred_message_to_columns(item)
            )
            cursor.execute(
                """
                INSERT INTO Messages (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (msg_id, chunks, chunk_uri, start_timestamp, tags, metadata, extra),
            )
        self.db.commit()


class SqliteSemanticRefCollection(interfaces.ISemanticRefCollection):
    def __init__(self, db: sqlite3.Connection):
        self.db = db

    def _serialize(self, sem_ref: interfaces.SemanticRef) -> dict[str, typing.Any]:
        return sem_ref.serialize()  # type: ignore[return-value]

    def _deserialize(self, data: dict[str, typing.Any]) -> interfaces.SemanticRef:
        return interfaces.SemanticRef.deserialize(data)  # type: ignore[arg-type]

    @property
    def is_persistent(self) -> bool:
        return True

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM SemanticRefs")
        return cursor.fetchone()[0]

    async def __aiter__(self) -> typing.AsyncIterator[interfaces.SemanticRef]:
        cursor = self.db.cursor()
        cursor.execute("SELECT srdata FROM SemanticRefs")
        for row in cursor:
            json_obj = json.loads(row[0])
            yield self._deserialize(json_obj)

    async def get_item(self, arg: int) -> interfaces.SemanticRef:
        if not isinstance(arg, int):
            raise TypeError(f"Index must be an int, not {type(arg).__name__}")
        cursor = self.db.cursor()
        cursor.execute("SELECT srdata FROM SemanticRefs WHERE id = ?", (arg,))
        row = cursor.fetchone()
        if row:
            json_obj = json.loads(row[0])
            return self._deserialize(json_obj)
        raise IndexError("SemanticRef not found")

    async def get_slice(self, start: int, stop: int) -> list[interfaces.SemanticRef]:
        if stop <= start:
            return []
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT srdata FROM SemanticRefs WHERE id >= ? AND id < ?",
            (start, stop),
        )
        return [self._deserialize(json.loads(row[0])) for row in cursor.fetchall()]

    async def get_multiple(self, arg: list[int]) -> list[interfaces.SemanticRef]:
        # TODO: Do we really want to support this?
        # If so, we should probably try to optimize it.
        results = []
        for i in arg:
            results.append(await self.get_item(i))
        return results

    async def append(self, item: interfaces.SemanticRef) -> None:
        cursor = self.db.cursor()
        json_obj = self._serialize(item)
        serialized_message = json.dumps(json_obj)
        cursor.execute(
            "INSERT INTO SemanticRefs (id, srdata) VALUES (?, ?)",
            (item.semantic_ref_ordinal, serialized_message),
        )
        self.db.commit()

    async def extend(self, items: typing.Iterable[interfaces.SemanticRef]) -> None:
        cursor = self.db.cursor()
        for item in items:
            json_obj = self._serialize(item)
            serialized_message = json.dumps(json_obj)
            cursor.execute(
                "INSERT INTO SemanticRefs (id, srdata) VALUES (?, ?)",
                (item.semantic_ref_ordinal, serialized_message),
            )
        self.db.commit()


class SqliteStorageProvider[TMessage: interfaces.IMessage](
    interfaces.IStorageProvider[TMessage]
):
    """A storage provider backed by SQLite.

    NOTE: You can create only one message collection
    and one semantic ref collection per provider.
    For now, indexes are stored in memory (not persisted to SQLite).
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.db: sqlite3.Connection | None = None
        # In-memory indexes for now - TODO: persist to SQLite
        self._conversation_index: TermToSemanticRefIndex | None = None
        self._property_index: PropertyIndex | None = None
        self._timestamp_index: TimestampToTextRangeIndex | None = None
        self._message_text_index: interfaces.IMessageTextIndex[TMessage] | None = None
        self._related_terms_index: RelatedTermsIndex | None = None
        self._conversation_threads: ConversationThreads | None = None

    @classmethod
    async def create(
        cls,
        message_text_settings: MessageTextIndexSettings,
        related_terms_settings: RelatedTermIndexSettings,
        db_path: str,
    ) -> "SqliteStorageProvider[TMessage]":
        """Create and initialize a SqliteStorageProvider with all indexes."""
        instance = cls(db_path)
        # Initialize all indexes to ensure they exist in memory
        instance._conversation_index = TermToSemanticRefIndex()
        instance._property_index = PropertyIndex()
        instance._timestamp_index = TimestampToTextRangeIndex()

        # Use the provided settings instead of creating new ones
        instance._message_text_index = MessageTextIndex(message_text_settings)
        instance._related_terms_index = RelatedTermsIndex(related_terms_settings)
        instance._conversation_threads = ConversationThreads(
            related_terms_settings.embedding_index_settings
        )
        return instance

    async def close(self) -> None:
        if self.db is not None:
            self.db.close()
            self.db = None

    def get_db(self) -> sqlite3.Connection:
        if self.db is None:
            self.db = sqlite3.connect(self.db_path)
            self.db.execute(MESSAGES_SCHEMA)
            self.db.execute(MESSAGES_INDEX_SCHEMA)
            self.db.execute(SEMANTIC_REFS_SCHEMA)
            self.db.commit()
        return self.db

    async def get_message_collection(
        self,
        message_type: type[TMessage],
    ) -> SqliteMessageCollection[TMessage]:
        return SqliteMessageCollection[TMessage](self.get_db(), message_type)

    async def get_semantic_ref_collection(self) -> interfaces.ISemanticRefCollection:
        return SqliteSemanticRefCollection(self.get_db())

    # Index getter methods
    async def get_semantic_ref_index(self) -> interfaces.ITermToSemanticRefIndex:
        assert (
            self._conversation_index is not None
        ), "Use SqliteStorageProvider.create() to create an initialized instance"
        return self._conversation_index

    async def get_property_index(self) -> interfaces.IPropertyToSemanticRefIndex:
        assert (
            self._property_index is not None
        ), "Use SqliteStorageProvider.create() to create an initialized instance"
        return self._property_index

    async def get_timestamp_index(self) -> interfaces.ITimestampToTextRangeIndex:
        assert (
            self._timestamp_index is not None
        ), "Use SqliteStorageProvider.create() to create an initialized instance"
        return self._timestamp_index

    async def get_message_text_index(self) -> interfaces.IMessageTextIndex[TMessage]:
        assert (
            self._message_text_index is not None
        ), "Use SqliteStorageProvider.create() to create an initialized instance"
        return self._message_text_index

    async def get_related_terms_index(self) -> interfaces.ITermToRelatedTermsIndex:
        assert (
            self._related_terms_index is not None
        ), "Use SqliteStorageProvider.create() to create an initialized instance"
        return self._related_terms_index

    async def get_conversation_threads(self) -> interfaces.IConversationThreads:
        assert (
            self._conversation_threads is not None
        ), "Use SqliteStorageProvider.create() to create an initialized instance"
        return self._conversation_threads
