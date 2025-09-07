# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SQLite-based message text index implementation."""

import json
import sqlite3
import typing

import numpy as np

from ...aitools.embeddings import NormalizedEmbedding, NormalizedEmbeddings
from ...aitools.vectorbase import VectorBase

from ...knowpro.convsettings import MessageTextIndexSettings
from ...knowpro import interfaces
from ...knowpro.textlocindex import ScoredTextLocation

from ...storage.memory.messageindex import IMessageTextEmbeddingIndex

from .schema import deserialize_embedding, serialize_embedding


class SqliteMessageTextIndex(IMessageTextEmbeddingIndex):
    """SQLite-backed message text index with embedding support."""

    def __init__(
        self,
        db: sqlite3.Connection,
        settings: MessageTextIndexSettings,
        message_collection: interfaces.IMessageCollection | None = None,
    ):
        self.db = db
        self.settings = settings
        self._message_collection = message_collection
        self._vectorbase = VectorBase(settings=settings.embedding_index_settings)
        if self._size():
            cursor = self.db.cursor()
            cursor.execute("SELECT embedding FROM MessageTextIndex")
            for row in cursor.fetchall():
                self._vectorbase.add_embedding(None, deserialize_embedding(row[0]))

    async def size(self) -> int:
        return self._size()

    def _size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM MessageTextIndex")
        return cursor.fetchone()[0]

    async def add_messages_starting_at(
        self,
        start_message_ordinal: int,
        messages: list[interfaces.IMessage],
    ) -> None:
        """Add messages to the text index starting at the given ordinal."""
        chunks_to_embed: list[tuple[int, int, str]] = []
        for msg_ord, message in enumerate(messages, start_message_ordinal):
            for chunk_ord, chunk in enumerate(message.text_chunks):
                chunks_to_embed.append((msg_ord, chunk_ord, chunk))

        embeddings = await self._vectorbase.get_embeddings(
            [chunk for _, _, chunk in chunks_to_embed], cache=False
        )

        insertion_data: list[tuple[int, int, bytes]] = []
        for (msg_ord, chunk_ord, _), embedding in zip(chunks_to_embed, embeddings):
            insertion_data.append((msg_ord, chunk_ord, serialize_embedding(embedding)))

        # Bulk insert text chunks (without embeddings yet)
        cursor = self.db.cursor()
        if insertion_data:
            cursor.executemany(
                """
                INSERT INTO MessageTextIndex
                (msg_id, chunk_ordinal, embedding)
                VALUES (?, ?, ?)
                """,
                insertion_data,
            )

    async def add_messages(
        self,
        messages: typing.Iterable[interfaces.IMessage],
    ) -> None:
        """Add messages to the text index (backward compatibility method)."""
        message_list = list(messages)
        if not message_list:
            return

        # Get the current collection size to determine starting ordinal
        start_ordinal = await self.size()

        await self.add_messages_starting_at(start_ordinal, message_list)

    async def rebuild_from_all_messages(self) -> None:
        """Rebuild the entire message text index from all messages in the collection."""
        if self._message_collection is None:
            return

        # Clear existing index
        await self.clear()

        # Add all messages with their ordinals
        message_list = await self._message_collection.get_slice(
            0, await self._message_collection.size()
        )

        if message_list:
            await self.add_messages_starting_at(0, message_list)

        print(f"DEBUG: Rebuilt message text index with {await self.size()} entries")

    async def lookup_text(
        self, text: str, max_matches: int | None = None, min_score: float | None = None
    ) -> list[ScoredTextLocation]:
        """Look up text using VectorBase."""
        # Generate embedding for the search text
        search_embedding = await self._vectorbase.get_embedding(text)

        # Get all stored embeddings and compute similarity
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT msg_id, chunk_ordinal, embedding FROM MessageTextIndex WHERE embedding IS NOT NULL"
        )

        scored_locations = []
        for row in cursor.fetchall():
            msg_id, chunk_ordinal, embedding_blob = row
            if embedding_blob:
                stored_embedding = deserialize_embedding(embedding_blob)
                if stored_embedding is not None:
                    # Compute cosine similarity
                    similarity = np.dot(search_embedding, stored_embedding)

                    if min_score is None or similarity >= min_score:
                        text_location = interfaces.TextLocation(
                            message_ordinal=msg_id,
                            chunk_ordinal=chunk_ordinal,
                        )
                        scored_locations.append(
                            ScoredTextLocation(text_location, similarity)
                        )

        # Sort by score (highest first)
        scored_locations.sort(key=lambda x: x.score, reverse=True)

        # Apply max_matches limit
        if max_matches is not None:
            scored_locations = scored_locations[:max_matches]

        return scored_locations

    async def lookup_messages(
        self,
        message_text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[interfaces.ScoredMessageOrdinal]:
        """Look up messages by text content."""
        # Use lookup_text to find text locations
        scored_locations = await self.lookup_text(message_text, None, threshold_score)

        # Convert to scored message ordinals (group by message)
        message_scores: dict[int, float] = {}
        for scored_loc in scored_locations:
            msg_ord = scored_loc.text_location.message_ordinal
            if msg_ord not in message_scores:
                message_scores[msg_ord] = scored_loc.score
            else:
                # Take the max score across chunks
                message_scores[msg_ord] = max(message_scores[msg_ord], scored_loc.score)

        # Convert to list and sort by score
        results = [
            interfaces.ScoredMessageOrdinal(message_ordinal=ordinal, score=score)
            for ordinal, score in message_scores.items()
        ]
        results.sort(key=lambda x: x.score, reverse=True)

        if max_matches is not None:
            results = results[:max_matches]

        return results

    async def lookup_messages_in_subset(
        self,
        message_text: str,
        ordinals_to_search: list[interfaces.MessageOrdinal],
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[interfaces.ScoredMessageOrdinal]:
        """Look up messages in a subset of ordinals."""
        # Get all matches first
        all_matches = await self.lookup_messages(message_text, None, threshold_score)

        # Filter to only include the specified ordinals
        ordinals_set = set(ordinals_to_search)
        filtered_matches = [
            match for match in all_matches if match.message_ordinal in ordinals_set
        ]

        # Apply max_matches limit
        if max_matches is not None:
            filtered_matches = filtered_matches[:max_matches]

        return filtered_matches

    # async def generate_embedding(self, text: str) -> NormalizedEmbedding:
    #     """Generate an embedding for the given text."""
    #     return await self._vectorbase.get_embedding(text)

    def lookup_by_embedding(
        self,
        text_embedding: NormalizedEmbedding,
        max_matches: int | None = None,
        threshold_score: float | None = None,
        predicate: typing.Callable[[interfaces.MessageOrdinal], bool] | None = None,
    ) -> list[interfaces.ScoredMessageOrdinal]:
        """Look up messages by embedding (synchronous version)."""
        # Get all stored embeddings and compute similarity
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT msg_id, chunk_ordinal, embedding FROM MessageTextIndex WHERE embedding IS NOT NULL"
        )

        from ..sqlite.schema import deserialize_embedding
        import numpy as np

        message_scores: dict[int, float] = {}
        for row in cursor.fetchall():
            msg_id, chunk_ordinal, embedding_blob = row
            if embedding_blob and (predicate is None or predicate(msg_id)):
                stored_embedding = deserialize_embedding(embedding_blob)
                if stored_embedding is not None:
                    # Compute cosine similarity
                    similarity = np.dot(text_embedding, stored_embedding)

                    if threshold_score is None or similarity >= threshold_score:
                        if msg_id not in message_scores:
                            message_scores[msg_id] = similarity
                        else:
                            # Take the best score for this message
                            message_scores[msg_id] = max(
                                message_scores[msg_id], similarity
                            )

        # Convert to list and sort by score
        result = [
            interfaces.ScoredMessageOrdinal(msg_ordinal, score)
            for msg_ordinal, score in message_scores.items()
        ]
        result.sort(key=lambda x: x.score, reverse=True)

        # Apply max_matches limit
        if max_matches is not None:
            result = result[:max_matches]

        return result

    def lookup_in_subset_by_embedding(
        self,
        text_embedding: NormalizedEmbedding,
        ordinals_to_search: list[interfaces.MessageOrdinal],
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[interfaces.ScoredMessageOrdinal]:
        """Look up messages in a subset by embedding (synchronous version)."""
        # Use the predicate version to filter by ordinals
        ordinals_set = set(ordinals_to_search)
        return self.lookup_by_embedding(
            text_embedding,
            max_matches,
            threshold_score,
            predicate=lambda ordinal: ordinal in ordinals_set,
        )

    async def is_empty(self) -> bool:
        """Check if the index is empty."""
        size = await self.size()
        return size == 0

    async def serialize(self) -> interfaces.MessageTextIndexData:
        """Serialize the message text index."""
        # Get all data from the MessageTextIndex table
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT msg_id, chunk_ordinal, embedding
            FROM MessageTextIndex
            ORDER BY msg_id, chunk_ordinal
        """
        )

        # Build the text locations and embeddings
        text_locations = []
        embeddings_list = []

        from ..sqlite.schema import deserialize_embedding
        from ...knowpro.interfaces import TextLocationData, TextToTextLocationIndexData

        for msg_id, chunk_ordinal, embedding_blob in cursor.fetchall():
            # Create text location data
            text_location = TextLocationData(
                messageOrdinal=msg_id, chunkOrdinal=chunk_ordinal
            )
            text_locations.append(text_location)

            if embedding_blob:
                embedding = deserialize_embedding(embedding_blob)
                embeddings_list.append(embedding)
            else:
                # Handle case where embedding is None
                embeddings_list.append(None)

        if text_locations:
            # Convert embeddings to numpy array if we have any
            import numpy as np

            valid_embeddings = [e for e in embeddings_list if e is not None]
            if valid_embeddings:
                embeddings_array = np.array(valid_embeddings, dtype=np.float32)
            else:
                embeddings_array = None

            index_data = TextToTextLocationIndexData(
                textLocations=text_locations, embeddings=embeddings_array
            )
            return interfaces.MessageTextIndexData(indexData=index_data)

        return {}

    async def deserialize(self, data: interfaces.MessageTextIndexData) -> None:
        """Deserialize message text index data."""
        cursor = self.db.cursor()

        # Clear existing data
        cursor.execute("DELETE FROM MessageTextIndex")

        # Get the index data
        index_data = data.get("indexData")
        if not index_data:
            return

        text_locations = index_data.get("textLocations", [])
        if not text_locations:
            return

        embeddings = index_data.get("embeddings")
        if embeddings is None:
            return

        # Prepare all insertion data for bulk operation
        insertion_data: list[tuple[int, int, bytes]] = []
        for text_location, embedding in zip(text_locations, embeddings, strict=True):
            msg_id = text_location["messageOrdinal"]
            chunk_ordinal = text_location["chunkOrdinal"]
            assert embedding is not None
            embedding_blob = serialize_embedding(embedding)
            insertion_data.append((msg_id, chunk_ordinal, embedding_blob))

        # Bulk insert all the data
        if insertion_data:
            cursor.executemany(
                """
                INSERT INTO MessageTextIndex
                (msg_id, chunk_ordinal, embedding)
                VALUES (?, ?, ?)
                """,
                insertion_data,
            )

        # Update VectorBase
        self._vectorbase.add_embeddings(embeddings)

    async def clear(self) -> None:
        """Clear the message text index."""
        cursor = self.db.cursor()
        cursor.execute("DELETE FROM MessageTextIndex")
