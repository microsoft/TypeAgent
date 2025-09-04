# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SQLite-based index implementations."""

import sqlite3
from ...aitools.embeddings import AsyncEmbeddingModel
import typing

from ...aitools.embeddings import NormalizedEmbedding
from ...aitools.vectorbase import TextEmbeddingIndexSettings, VectorBase

from ...knowpro.convsettings import MessageTextIndexSettings
from ...knowpro import interfaces
from ...knowpro.textlocindex import ScoredTextLocation

from ...storage.memory.messageindex import IMessageTextEmbeddingIndex


class SqliteTermToSemanticRefIndex(interfaces.ITermToSemanticRefIndex):
    """SQLite-backed implementation of term to semantic ref index."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(DISTINCT term) FROM SemanticRefIndex")
        return cursor.fetchone()[0]

    async def get_terms(self) -> list[str]:
        cursor = self.db.cursor()
        cursor.execute("SELECT DISTINCT term FROM SemanticRefIndex ORDER BY term")
        return [row[0] for row in cursor.fetchall()]

    async def add_term(
        self,
        term: str,
        semantic_ref_ordinal: (
            interfaces.SemanticRefOrdinal | interfaces.ScoredSemanticRefOrdinal
        ),
    ) -> str:
        if not term:
            return term

        term = self._prepare_term(term)

        # Extract semref_id from the ordinal
        if isinstance(semantic_ref_ordinal, interfaces.ScoredSemanticRefOrdinal):
            semref_id = semantic_ref_ordinal.semantic_ref_ordinal
        else:
            semref_id = semantic_ref_ordinal

        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                """
                INSERT OR IGNORE INTO SemanticRefIndex (term, semref_id)
                VALUES (?, ?)
                """,
                (term, semref_id),
            )

        return term

    async def remove_term(
        self, term: str, semantic_ref_ordinal: interfaces.SemanticRefOrdinal
    ) -> None:
        term = self._prepare_term(term)
        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                "DELETE FROM SemanticRefIndex WHERE term = ? AND semref_id = ?",
                (term, semantic_ref_ordinal),
            )

    async def lookup_term(
        self, term: str
    ) -> list[interfaces.ScoredSemanticRefOrdinal] | None:
        term = self._prepare_term(term)
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT semref_id FROM SemanticRefIndex WHERE term = ?",
            (term,),
        )

        # Return as ScoredSemanticRefOrdinal with default score of 1.0
        results = []
        for row in cursor.fetchall():
            semref_id = row[0]
            results.append(interfaces.ScoredSemanticRefOrdinal(semref_id, 1.0))
        return results

    async def clear(self) -> None:
        """Clear all terms from the semantic ref index."""
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM SemanticRefIndex")

    def serialize(self) -> interfaces.TermToSemanticRefIndexData:
        """Serialize the index data for compatibility with in-memory version."""
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT term, semref_id FROM SemanticRefIndex ORDER BY term, semref_id"
        )

        # Group by term
        term_to_semrefs: dict[str, list[interfaces.ScoredSemanticRefOrdinalData]] = {}
        for term, semref_id in cursor.fetchall():
            if term not in term_to_semrefs:
                term_to_semrefs[term] = []
            scored_ref = interfaces.ScoredSemanticRefOrdinal(semref_id, 1.0)
            term_to_semrefs[term].append(scored_ref.serialize())

        # Convert to the expected format
        items = []
        for term, semref_ordinals in term_to_semrefs.items():
            items.append(
                interfaces.TermToSemanticRefIndexItemData(
                    term=term, semanticRefOrdinals=semref_ordinals
                )
            )

        return interfaces.TermToSemanticRefIndexData(items=items)

    def deserialize(self, data: interfaces.TermToSemanticRefIndexData) -> None:
        """Deserialize index data by populating the SQLite table."""
        # Clear existing data
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM SemanticRefIndex")

            # Add all the terms
            for item in data["items"]:
                if item and item["term"]:
                    term = item["term"]
                    for semref_ordinal_data in item["semanticRefOrdinals"]:
                        if isinstance(semref_ordinal_data, dict):
                            semref_id = semref_ordinal_data["semanticRefOrdinal"]
                        else:
                            # Fallback for direct integer
                            semref_id = semref_ordinal_data
                        cursor.execute(
                            "INSERT OR IGNORE INTO SemanticRefIndex (term, semref_id) VALUES (?, ?)",
                            (self._prepare_term(term), semref_id),
                        )

    def _prepare_term(self, term: str) -> str:
        """Normalize term by converting to lowercase."""
        return term.lower()


class SqlitePropertyIndex(interfaces.IPropertyToSemanticRefIndex):
    """SQLite-backed implementation of property to semantic ref index."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM (SELECT DISTINCT prop_name, value_str FROM PropertyIndex)"
        )
        return cursor.fetchone()[0]

    async def get_values(self) -> list[str]:
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT DISTINCT value_str FROM PropertyIndex ORDER BY value_str"
        )
        return [row[0] for row in cursor.fetchall()]

    async def add_property(
        self,
        property_name: str,
        value: str,
        semantic_ref_ordinal: (
            interfaces.SemanticRefOrdinal | interfaces.ScoredSemanticRefOrdinal
        ),
    ) -> None:
        # Extract semref_id and score from the ordinal
        if isinstance(semantic_ref_ordinal, interfaces.ScoredSemanticRefOrdinal):
            semref_id = semantic_ref_ordinal.semantic_ref_ordinal
            score = semantic_ref_ordinal.score
        else:
            semref_id = semantic_ref_ordinal
            score = 1.0

        # Normalize property name and value (to match in-memory implementation)
        from ...storage.memory.propindex import (
            make_property_term_text,
            split_property_term_text,
        )

        term_text = make_property_term_text(property_name, value)
        term_text = term_text.lower()  # Matches PropertyIndex._prepare_term_text
        property_name, value = split_property_term_text(term_text)
        # Remove "prop." prefix that was added by make_property_term_text
        if property_name.startswith("prop."):
            property_name = property_name[5:]

        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                """
                INSERT INTO PropertyIndex (prop_name, value_str, score, semref_id)
                VALUES (?, ?, ?, ?)
                """,
                (property_name, value, score, semref_id),
            )

    async def clear(self) -> None:
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM PropertyIndex")

    async def lookup_property(
        self,
        property_name: str,
        value: str,
    ) -> list[interfaces.ScoredSemanticRefOrdinal] | None:
        # Normalize property name and value (to match in-memory implementation)
        from ...storage.memory.propindex import (
            make_property_term_text,
            split_property_term_text,
        )

        term_text = make_property_term_text(property_name, value)
        term_text = term_text.lower()  # Matches PropertyIndex._prepare_term_text
        property_name, value = split_property_term_text(term_text)
        # Remove "prop." prefix that was added by make_property_term_text
        if property_name.startswith("prop."):
            property_name = property_name[5:]

        cursor = self.db.cursor()
        cursor.execute(
            "SELECT semref_id, score FROM PropertyIndex WHERE prop_name = ? AND value_str = ?",
            (property_name, value),
        )

        results = [
            interfaces.ScoredSemanticRefOrdinal(semref_id, score)
            for semref_id, score in cursor.fetchall()
        ]

        return results if results else None

    async def remove_property(self, prop_name: str, semref_id: int) -> None:
        """Remove all properties for a specific property name and semantic ref."""
        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                "DELETE FROM PropertyIndex WHERE prop_name = ? AND semref_id = ?",
                (prop_name, semref_id),
            )

    async def remove_all_for_semref(self, semref_id: int) -> None:
        """Remove all properties for a specific semantic ref."""
        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                "DELETE FROM PropertyIndex WHERE semref_id = ?",
                (semref_id,),
            )


class SqliteTimestampToTextRangeIndex(interfaces.ITimestampToTextRangeIndex):
    """SQL-based timestamp index that queries Messages table directly."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def size(self) -> int:
        return self._size()

    def _size(self) -> int:
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
        with self.db:
            cursor = self.db.cursor()
            cursor.execute(
                "UPDATE Messages SET start_timestamp = ? WHERE msg_id = ?",
                (timestamp, message_ordinal),
            )
            return cursor.rowcount > 0

    async def get_timestamp_ranges(
        self, start_timestamp: str, end_timestamp: str | None = None
    ) -> list[interfaces.TimestampedTextRange]:
        """Get timestamp ranges from Messages table."""
        cursor = self.db.cursor()

        if end_timestamp is None:
            # Single timestamp query
            cursor.execute(
                """
                SELECT msg_id, start_timestamp
                FROM Messages
                WHERE start_timestamp = ?
                ORDER BY msg_id
                """,
                (start_timestamp,),
            )
        else:
            # Range query
            cursor.execute(
                """
                SELECT msg_id, start_timestamp
                FROM Messages
                WHERE start_timestamp >= ? AND start_timestamp <= ?
                ORDER BY msg_id
                """,
                (start_timestamp, end_timestamp),
            )

        results = []
        for msg_id, timestamp in cursor.fetchall():
            # Create text range for message
            from ...knowpro.interfaces import TextLocation, TextRange

            text_range = TextRange(
                start=TextLocation(message_ordinal=msg_id, chunk_ordinal=0)
            )
            results.append(
                interfaces.TimestampedTextRange(range=text_range, timestamp=timestamp)
            )

        return results

    async def add_timestamps(
        self, message_timestamps: list[tuple[interfaces.MessageOrdinal, str]]
    ) -> None:
        """Add multiple timestamps."""
        with self.db:
            cursor = self.db.cursor()
            for message_ordinal, timestamp in message_timestamps:
                cursor.execute(
                    "UPDATE Messages SET start_timestamp = ? WHERE msg_id = ?",
                    (timestamp, message_ordinal),
                )

    async def lookup_range(
        self, date_range: interfaces.DateRange
    ) -> list[interfaces.TimestampedTextRange]:
        """Lookup messages in a date range."""
        cursor = self.db.cursor()

        # Convert datetime objects to ISO format strings for comparison
        start_timestamp = date_range.start.isoformat().replace("+00:00", "Z")
        end_timestamp = (
            date_range.end.isoformat().replace("+00:00", "Z")
            if date_range.end
            else None
        )

        if date_range.end is None:
            # Point query
            cursor.execute(
                """
                SELECT msg_id, start_timestamp, chunks
                FROM Messages
                WHERE start_timestamp = ?
                ORDER BY msg_id
                """,
                (start_timestamp,),
            )
        else:
            # Range query
            cursor.execute(
                """
                SELECT msg_id, start_timestamp, chunks
                FROM Messages
                WHERE start_timestamp >= ? AND start_timestamp < ?
                ORDER BY msg_id
                """,
                (start_timestamp, end_timestamp),
            )

        results = []
        for msg_id, timestamp, chunks in cursor.fetchall():
            text_location = interfaces.TextLocation(
                message_ordinal=msg_id, chunk_ordinal=0
            )
            text_range = interfaces.TextRange(
                start=text_location, end=None  # Point range
            )
            results.append(
                interfaces.TimestampedTextRange(timestamp=timestamp, range=text_range)
            )

        return results


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
        # Use the embedding model from settings
        self._embedding_model = settings.embedding_index_settings.embedding_model

    async def build_embeddings_from_messages(
        self, message_ordinal_pairs: list[tuple[int, interfaces.IMessage]]
    ) -> None:
        """Build embeddings for the given list of (ordinal, message) pairs."""
        print(
            f"DEBUG: build_embeddings_from_messages() called with {len(message_ordinal_pairs)} messages"
        )
        if not message_ordinal_pairs:
            return

        # Collect all text chunks that need embeddings
        text_chunks_to_embed = []
        for message_ordinal, message in message_ordinal_pairs:
            for chunk_ordinal, chunk in enumerate(message.text_chunks):
                text_chunks_to_embed.append((message_ordinal, chunk_ordinal, chunk))

        if text_chunks_to_embed:
            print(
                f"DEBUG: Generating embeddings for {len(text_chunks_to_embed)} text chunks"
            )

            # Generate embeddings in batch for efficiency
            texts = [chunk for _, _, chunk in text_chunks_to_embed]
            embeddings = await self._embedding_model.get_embeddings(texts)

            # Store in SQLite
            from ..sqlite.schema import serialize_embedding

            with self.db:
                cursor = self.db.cursor()
                for (msg_id, chunk_ordinal, text), embedding in zip(
                    text_chunks_to_embed, embeddings
                ):
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO MessageTextIndex
                        (msg_id, chunk_ordinal, text_content, embedding)
                        VALUES (?, ?, ?, ?)
                        """,
                        (msg_id, chunk_ordinal, text, serialize_embedding(embedding)),
                    )

            print(
                f"DEBUG: Stored {len(text_chunks_to_embed)} text chunks with embeddings"
            )

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM MessageTextIndex")
        return cursor.fetchone()[0]

    async def add_messages_starting_at(
        self,
        start_ordinal: int,
        messages: list[interfaces.IMessage],
    ) -> None:
        """Add messages to the text index starting at the given ordinal."""
        text_chunks_to_embed = []

        # First, store the text chunks in SQLite (without embeddings yet)
        with self.db:
            cursor = self.db.cursor()
            for i, message in enumerate(messages):
                message_ordinal = start_ordinal + i
                for chunk_ordinal, chunk in enumerate(message.text_chunks):
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO MessageTextIndex
                        (msg_id, chunk_ordinal, text_content, embedding)
                        VALUES (?, ?, ?, NULL)
                        """,
                        (message_ordinal, chunk_ordinal, chunk),
                    )
                    text_chunks_to_embed.append((message_ordinal, chunk_ordinal, chunk))

        # Generate and store embeddings
        if text_chunks_to_embed:
            texts = [chunk for _, _, chunk in text_chunks_to_embed]
            embeddings = await self._embedding_model.get_embeddings(texts)

            from ..sqlite.schema import serialize_embedding

            with self.db:
                cursor = self.db.cursor()
                for (msg_id, chunk_ordinal, text), embedding in zip(
                    text_chunks_to_embed, embeddings
                ):
                    cursor.execute(
                        """
                        UPDATE MessageTextIndex
                        SET embedding = ?
                        WHERE msg_id = ? AND chunk_ordinal = ?
                        """,
                        (serialize_embedding(embedding), msg_id, chunk_ordinal),
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
        if self._message_collection is not None:
            start_ordinal = await self._message_collection.size() - len(message_list)
        else:
            start_ordinal = 0

        await self.add_messages_starting_at(start_ordinal, message_list)

    async def rebuild_from_all_messages(self) -> None:
        """Rebuild the entire message text index from all messages in the collection."""
        if self._message_collection is None:
            return

        print("DEBUG: Rebuilding message text index from all messages...")

        # Clear existing index
        await self.clear()

        # Add all messages with their ordinals
        message_list = []
        async for message in self._message_collection:
            message_list.append(message)

        if message_list:
            await self.add_messages_starting_at(0, message_list)

        print(f"DEBUG: Rebuilt message text index with {await self.size()} entries")

    async def lookup_text(
        self, text: str, max_matches: int | None = None, min_score: float | None = None
    ) -> list[ScoredTextLocation]:
        """Look up text using embeddings stored in SQLite."""
        # Generate embedding for the search text
        search_embedding = await self._embedding_model.get_embedding(text)

        # Get all stored embeddings and compute similarity
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT msg_id, chunk_ordinal, embedding FROM MessageTextIndex WHERE embedding IS NOT NULL"
        )

        from ..sqlite.schema import deserialize_embedding
        import numpy as np

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

    async def generate_embedding(self, text: str) -> NormalizedEmbedding:
        """Generate an embedding for the given text."""
        return await self._embedding_model.get_embedding(text)

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

    def serialize(self) -> interfaces.MessageTextIndexData:
        """Serialize the message text index."""
        # Get all data from the MessageTextIndex table
        cursor = self.db.cursor()
        cursor.execute(
            """
            SELECT msg_id, chunk_ordinal, text_content, embedding 
            FROM MessageTextIndex 
            ORDER BY msg_id, chunk_ordinal
        """
        )

        # Build the text locations and embeddings
        text_locations = []
        embeddings_list = []

        from ..sqlite.schema import deserialize_embedding
        from ...knowpro.interfaces import TextLocationData, TextToTextLocationIndexData

        for msg_id, chunk_ordinal, text_content, embedding_blob in cursor.fetchall():
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

    def deserialize(self, data: interfaces.MessageTextIndexData) -> None:
        """Deserialize message text index data."""
        # Clear existing data
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM MessageTextIndex")

        # Get the index data
        index_data = data.get("indexData")
        if not index_data:
            return

        text_locations = index_data.get("textLocations", [])
        embeddings = index_data.get("embeddings")

        if not text_locations:
            return

        # Prepare data for insertion
        from ..sqlite.schema import serialize_embedding

        with self.db:
            cursor = self.db.cursor()

            for i, text_location in enumerate(text_locations):
                msg_id = text_location["messageOrdinal"]
                chunk_ordinal = text_location["chunkOrdinal"]

                # Get the text content from the Messages table
                cursor.execute(
                    "SELECT chunks FROM Messages WHERE msg_id = ?", (msg_id,)
                )
                row = cursor.fetchone()
                if row:
                    import json

                    chunks = json.loads(row[0]) if row[0] else []
                    if chunk_ordinal < len(chunks):
                        text_content = chunks[chunk_ordinal]
                    else:
                        continue  # Skip if chunk doesn't exist
                else:
                    continue  # Skip if message doesn't exist

                # Get embedding if available
                embedding_blob = None
                if embeddings is not None and i < len(embeddings):
                    embedding = embeddings[i]
                    if embedding is not None:
                        embedding_blob = serialize_embedding(embedding)

                # Insert into MessageTextIndex
                cursor.execute(
                    """
                    INSERT INTO MessageTextIndex
                    (msg_id, chunk_ordinal, text_content, embedding)
                    VALUES (?, ?, ?, ?)
                    """,
                    (msg_id, chunk_ordinal, text_content, embedding_blob),
                )

    async def clear(self) -> None:
        """Clear the message text index."""
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM MessageTextIndex")


# Related terms index implementations


class SqliteRelatedTermsAliases(interfaces.ITermToRelatedTerms):
    """SQLite-backed implementation of term to related terms aliases."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def lookup_term(self, text: str) -> list[interfaces.Term] | None:
        cursor = self.db.cursor()
        cursor.execute("SELECT alias FROM RelatedTermsAliases WHERE term = ?", (text,))
        results = [interfaces.Term(row[0]) for row in cursor.fetchall()]
        return results if results else None

    async def add_related_term(
        self, text: str, related_terms: interfaces.Term | list[interfaces.Term]
    ) -> None:
        # Convert single Term to list
        if isinstance(related_terms, str):
            related_terms = [interfaces.Term(related_terms)]
        elif isinstance(related_terms, interfaces.Term):
            related_terms = [related_terms]

        with self.db:
            cursor = self.db.cursor()
            # Add new aliases (use INSERT OR IGNORE to avoid duplicates)
            for related_term in related_terms:
                cursor.execute(
                    "INSERT OR IGNORE INTO RelatedTermsAliases (term, alias) VALUES (?, ?)",
                    (text, related_term.text),
                )

    async def remove_term(self, text: str) -> None:
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM RelatedTermsAliases WHERE term = ?", (text,))

    async def clear(self) -> None:
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM RelatedTermsAliases")

    async def get_related_terms(self, term: str) -> list[str] | None:
        cursor = self.db.cursor()
        cursor.execute("SELECT alias FROM RelatedTermsAliases WHERE term = ?", (term,))
        results = [row[0] for row in cursor.fetchall()]
        return results if results else None

    async def set_related_terms(self, term: str, related_terms: list[str]) -> None:
        with self.db:
            cursor = self.db.cursor()
            # Clear existing aliases for this term
            cursor.execute("DELETE FROM RelatedTermsAliases WHERE term = ?", (term,))
            # Add new aliases
            for alias in related_terms:
                cursor.execute(
                    "INSERT INTO RelatedTermsAliases (term, alias) VALUES (?, ?)",
                    (term, alias),
                )

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(DISTINCT term) FROM RelatedTermsAliases")
        return cursor.fetchone()[0]

    async def get_terms(self) -> list[str]:
        cursor = self.db.cursor()
        cursor.execute("SELECT DISTINCT term FROM RelatedTermsAliases ORDER BY term")
        return [row[0] for row in cursor.fetchall()]

    async def is_empty(self) -> bool:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM RelatedTermsAliases")
        return cursor.fetchone()[0] == 0

    async def serialize(self) -> interfaces.TermToRelatedTermsData:
        """Serialize the aliases data."""
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT term, alias FROM RelatedTermsAliases ORDER BY term, alias"
        )

        # Group by term
        term_to_aliases: dict[str, list[str]] = {}
        for term, alias in cursor.fetchall():
            if term not in term_to_aliases:
                term_to_aliases[term] = []
            term_to_aliases[term].append(alias)

        # Convert to the expected format
        items = []
        for term, aliases in term_to_aliases.items():
            term_data_list = [interfaces.TermData(text=alias) for alias in aliases]
            items.append(
                interfaces.TermsToRelatedTermsDataItem(
                    termText=term, relatedTerms=term_data_list
                )
            )

        return interfaces.TermToRelatedTermsData(relatedTerms=items)

    async def deserialize(self, data: interfaces.TermToRelatedTermsData | None) -> None:
        """Deserialize alias data."""
        if data is None:
            return
        related_terms = data.get("relatedTerms", [])
        if related_terms:
            with self.db:
                cursor = self.db.cursor()
                cursor.execute("DELETE FROM RelatedTermsAliases")
                for item in related_terms:
                    if item and item.get("termText") and item.get("relatedTerms"):
                        term = item["termText"]
                        for term_data in item["relatedTerms"]:
                            alias = term_data["text"]
                            cursor.execute(
                                "INSERT INTO RelatedTermsAliases (term, alias) VALUES (?, ?)",
                                (term, alias),
                            )


from ...aitools.embeddings import AsyncEmbeddingModel


class SqliteRelatedTermsFuzzy(interfaces.ITermToRelatedTermsFuzzy):
    """SQLite-backed implementation of fuzzy term relationships with persistent embeddings."""

    def __init__(self, db: sqlite3.Connection, embedding_model: AsyncEmbeddingModel):
        self.db = db
        # embedding_model is used for generating term embeddings
        self._embedding_model = embedding_model

    async def lookup_term(
        self,
        text: str,
        max_hits: int | None = None,
        min_score: float | None = None,
    ) -> list[interfaces.Term]:
        # Generate embedding for query text
        query_embedding = await self._embedding_model.get_embedding(text)
        if query_embedding is None:
            return []

        # Get all stored terms and their embeddings
        cursor = self.db.cursor()
        cursor.execute(
            "SELECT DISTINCT term, term_embedding FROM RelatedTermsFuzzy WHERE term_embedding IS NOT NULL"
        )

        results = []
        from .schema import deserialize_embedding
        import numpy as np

        for term, embedding_blob in cursor.fetchall():
            if embedding_blob is None:
                continue

            # Deserialize the stored embedding
            stored_embedding = deserialize_embedding(embedding_blob)
            if stored_embedding is None:
                continue

            # Compute cosine similarity
            similarity = np.dot(query_embedding, stored_embedding) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(stored_embedding)
            )

            # Skip if below minimum score threshold
            if min_score is not None and similarity < min_score:
                continue

            # Skip exact self-match (similarity 1.0 with identical text)
            if term == text and abs(similarity - 1.0) < 0.001:
                continue

            results.append(interfaces.Term(term, float(similarity)))

        # Sort by similarity score descending
        results.sort(key=lambda x: x.weight, reverse=True)

        # Apply max_hits limit
        if max_hits is not None:
            results = results[:max_hits]

        return results

    async def add_related_term(
        self, term: str, related_terms: list[interfaces.Term]
    ) -> None:
        """Add related terms with embeddings to the fuzzy index."""
        # generate embedding for the main term
        term_embed = await self._embedding_model.get_embedding(term)
        from .schema import serialize_embedding

        with self.db:
            cursor = self.db.cursor()
            for rel in related_terms:
                # generate embedding for related term
                rel_embed = await self._embedding_model.get_embedding(rel.text)
                # use weight if provided
                weight = rel.weight if rel.weight is not None else 1.0
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO RelatedTermsFuzzy
                    (term, related_term, score, term_embedding, related_embedding)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        term,
                        rel.text,
                        weight,
                        serialize_embedding(term_embed),
                        serialize_embedding(rel_embed),
                    ),
                )

    async def remove_term(self, term: str) -> None:
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM RelatedTermsFuzzy WHERE term = ?", (term,))

    async def clear(self) -> None:
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM RelatedTermsFuzzy")

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(DISTINCT term) FROM RelatedTermsFuzzy")
        return cursor.fetchone()[0]

    async def get_terms(self) -> list[str]:
        cursor = self.db.cursor()
        cursor.execute("SELECT DISTINCT term FROM RelatedTermsFuzzy ORDER BY term")
        return [row[0] for row in cursor.fetchall()]

    async def add_terms(self, texts: list[str]) -> None:
        """Add terms with self-related embeddings."""
        from .schema import serialize_embedding

        with self.db:
            cursor = self.db.cursor()
            for text in texts:
                # generate embedding for term
                embed = await self._embedding_model.get_embedding(text)
                serialized = serialize_embedding(embed)
                # insert term as related to itself
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO RelatedTermsFuzzy
                    (term, related_term, score, term_embedding, related_embedding)
                    VALUES (?, ?, 1.0, ?, ?)
                    """,
                    (text, text, serialized, serialized),
                )

    async def get_related_terms(
        self, term: str, max_matches: int | None = None, min_score: float | None = None
    ) -> list[interfaces.Term] | None:
        cursor = self.db.cursor()

        query = "SELECT related_term, score FROM RelatedTermsFuzzy WHERE term = ?"
        params: list[typing.Any] = [term]

        if min_score is not None:
            query += " AND score >= ?"
            params.append(min_score)

        query += " ORDER BY score DESC"

        if max_matches is not None:
            query += " LIMIT ?"
            params.append(max_matches)

        cursor.execute(query, params)

        results = [
            interfaces.Term(related_term, score)
            for related_term, score in cursor.fetchall()
        ]
        return results if results else None

    async def lookup_terms(
        self,
        texts: list[str],
        max_hits: int | None = None,
        min_score: float | None = None,
    ) -> list[list[interfaces.Term]]:
        """Look up multiple terms at once."""
        results = []
        for text in texts:
            term_results = await self.lookup_term(text, max_hits, min_score)
            results.append(term_results)
        return results

    async def deserialize(self, data: interfaces.TextEmbeddingIndexData) -> None:
        """Deserialize fuzzy index data from JSON into SQLite database."""
        # Clear existing data
        await self.clear()

        # Get text items and embeddings from the data
        text_items = data.get("textItems")
        embeddings_data = data.get("embeddings")

        if not text_items or embeddings_data is None:
            return

        # Create temporary VectorBase to deserialize embeddings
        temp_settings = TextEmbeddingIndexSettings(self._embedding_model)
        temp_vectorbase = VectorBase(temp_settings)
        temp_vectorbase.deserialize(embeddings_data)

        # Store each text item with its embedding in the database
        from .schema import serialize_embedding

        with self.db:
            cursor = self.db.cursor()
            for i, text in enumerate(text_items):
                if i < len(temp_vectorbase):
                    # Get embedding from temporary VectorBase
                    embedding = temp_vectorbase.get_embedding_at(i)
                    if embedding is not None:
                        serialized_embedding = serialize_embedding(embedding)
                        # Insert as self-referential entry
                        cursor.execute(
                            """
                            INSERT OR REPLACE INTO RelatedTermsFuzzy
                            (term, related_term, score, term_embedding, related_embedding)
                            VALUES (?, ?, 1.0, ?, ?)
                            """,
                            (text, text, serialized_embedding, serialized_embedding),
                        )


from ...aitools.embeddings import AsyncEmbeddingModel


class SqliteRelatedTermsIndex(interfaces.ITermToRelatedTermsIndex):
    """SQLite-backed implementation of ITermToRelatedTermsIndex combining aliases and fuzzy index."""

    def __init__(self, db: sqlite3.Connection, embedding_model: AsyncEmbeddingModel):
        self.db = db
        # Initialize alias and fuzzy related terms indexes
        self._aliases = SqliteRelatedTermsAliases(db)
        # Pass embedding_model to fuzzy index for persistent embeddings
        self._fuzzy_index = SqliteRelatedTermsFuzzy(db, embedding_model)

    @property
    def aliases(self) -> interfaces.ITermToRelatedTerms:
        return self._aliases

    @property
    def fuzzy_index(self) -> interfaces.ITermToRelatedTermsFuzzy | None:
        return self._fuzzy_index

    async def serialize(self) -> interfaces.TermsToRelatedTermsIndexData:
        """Serialize is not needed for SQLite-backed implementation."""
        # Return empty data since persistence is handled by SQLite
        return interfaces.TermsToRelatedTermsIndexData()

    async def deserialize(self, data: interfaces.TermsToRelatedTermsIndexData) -> None:
        """Deserialize related terms index data."""
        # Deserialize alias data
        alias_data = data.get("aliasData")
        if alias_data is not None:
            await self._aliases.deserialize(alias_data)

        # Deserialize fuzzy index data
        text_embedding_data = data.get("textEmbeddingData")
        if text_embedding_data is not None:
            await self._fuzzy_index.deserialize(text_embedding_data)
