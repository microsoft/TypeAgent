# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SQLite-based index implementations."""

import json
import sqlite3
import typing

from ...knowpro import interfaces
from ...knowpro.messageindex import MessageTextIndexSettings
from ...knowpro.textlocindex import ScoredTextLocation
from .schema import (
    ShreddedMessageText,
    ShreddedPropertyIndex,
    ShreddedRelatedTermsAlias,
    ShreddedRelatedTermsFuzzy,
)


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
        from ...knowpro.propindex import (
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
        from ...knowpro.propindex import (
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


class SqliteMessageTextIndex(interfaces.IMessageTextIndex):
    """SQLite-backed message text index with embedding support."""

    def __init__(self, db: sqlite3.Connection, settings: MessageTextIndexSettings):
        self.db = db
        self.settings = settings
        # For simplicity, keep the embedding index in memory for now
        # In a full implementation, embeddings would also be stored in SQLite
        from ...knowpro.textlocindex import TextToTextLocationIndex

        self._text_to_location_index = TextToTextLocationIndex(
            settings.embedding_index_settings
        )

    async def size(self) -> int:
        cursor = self.db.cursor()
        cursor.execute("SELECT COUNT(*) FROM MessageTextIndex")
        return cursor.fetchone()[0]

    async def add_messages(
        self,
        messages: typing.AsyncIterable[interfaces.IMessage],
        base_message_ordinal: int,
    ) -> None:
        """Add messages to the text index."""
        i = 0
        async for message in messages:
            message_ordinal = base_message_ordinal + i
            for chunk_ordinal, chunk in enumerate(message.text_chunks):
                # Add to SQLite index
                with self.db:
                    cursor = self.db.cursor()
                    cursor.execute(
                        """
                        INSERT OR REPLACE INTO MessageTextIndex (msg_id, chunk_ordinal)
                        VALUES (?, ?)
                        """,
                        (message_ordinal, chunk_ordinal),
                    )

                # Add to embedding index
                text_location = interfaces.TextLocation(
                    message_ordinal=message_ordinal, chunk_ordinal=chunk_ordinal
                )
                await self._text_to_location_index.add_text_location(chunk, text_location)
            i += 1

    async def lookup_text(
        self, text: str, max_matches: int | None = None, min_score: float | None = None
    ) -> list[ScoredTextLocation]:
        """Look up text using embeddings."""
        return await self._text_to_location_index.lookup_text(
            text, max_matches, min_score
        )

    async def clear(self) -> None:
        """Clear the message text index."""
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM MessageTextIndex")
        self._text_to_location_index.clear()


# Related terms index implementations

class SqliteRelatedTermsAliases(interfaces.ITermToRelatedTerms):
    """SQLite-backed implementation of term to related terms aliases."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def lookup_term(self, term: str) -> list[interfaces.Term] | None:
        cursor = self.db.cursor()
        cursor.execute("SELECT alias FROM RelatedTermsAliases WHERE term = ?", (term,))
        results = [interfaces.Term(row[0]) for row in cursor.fetchall()]
        return results if results else None

    async def add_related_term(
        self, term: str, related_terms: list[interfaces.Term]
    ) -> None:
        with self.db:
            cursor = self.db.cursor()
            # Clear existing aliases for this term
            cursor.execute("DELETE FROM RelatedTermsAliases WHERE term = ?", (term,))
            # Add new aliases
            for related_term in related_terms:
                cursor.execute(
                    "INSERT INTO RelatedTermsAliases (term, alias) VALUES (?, ?)",
                    (term, related_term.text),
                )

    async def remove_term(self, term: str) -> None:
        with self.db:
            cursor = self.db.cursor()
            cursor.execute("DELETE FROM RelatedTermsAliases WHERE term = ?", (term,))

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

    def serialize(self) -> interfaces.TermToRelatedTermsData:
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
            items.append(
                interfaces.TermToRelatedTermsDataItem(
                    term=term, relatedTerms=aliases
                )
            )

        return interfaces.TermToRelatedTermsData(items=items)

    async def deserialize(self, data: interfaces.TermToRelatedTermsData) -> None:
        """Deserialize alias data."""
        related_terms = data.get("items", [])
        if related_terms:
            with self.db:
                cursor = self.db.cursor()
                cursor.execute("DELETE FROM RelatedTermsAliases")
                for item in related_terms:
                    if item and item.get("term") and item.get("relatedTerms"):
                        term = item["term"]
                        for alias in item["relatedTerms"]:
                            cursor.execute(
                                "INSERT INTO RelatedTermsAliases (term, alias) VALUES (?, ?)",
                                (term, alias),
                            )


class SqliteRelatedTermsFuzzy(interfaces.ITermToRelatedTermsFuzzy):
    """SQLite-backed implementation of fuzzy term relationships."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db

    async def lookup_term(self, term: str) -> list[interfaces.Term] | None:
        cursor = self.db.cursor()
        cursor.execute("SELECT related_term, score FROM RelatedTermsFuzzy WHERE term = ?", (term,))
        results = [
            interfaces.Term(related_term, score)
            for related_term, score in cursor.fetchall()
        ]
        return results if results else None

    async def add_related_term(
        self, term: str, related_terms: list[interfaces.Term]
    ) -> None:
        with self.db:
            cursor = self.db.cursor()
            for related_term in related_terms:
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO RelatedTermsFuzzy (term, related_term, score)
                    VALUES (?, ?, ?)
                    """,
                    (term, related_term.text, 1.0),
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

    async def add_terms(
        self, terms: typing.AsyncIterable[interfaces.Term], related_terms: list[interfaces.Term]
    ) -> None:
        """Add multiple terms."""
        async for term in terms:
            await self.add_related_term(term.text, related_terms)

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
        self, terms: list[str], max_matches: int | None = None, min_score: float | None = None
    ) -> list[interfaces.Term] | None:
        """Look up multiple terms at once."""
        all_results = []
        for term in terms:
            term_results = await self.lookup_term(term)
            if term_results:
                all_results.extend(term_results)
        
        # Sort by score and apply limits
        all_results.sort(key=lambda x: x.score or 0.0, reverse=True)
        
        if min_score is not None:
            all_results = [r for r in all_results if (r.score or 0.0) >= min_score]
            
        if max_matches is not None:
            all_results = all_results[:max_matches]
            
        return all_results if all_results else None

    async def deserialize(self, data: interfaces.TextEmbeddingIndexData) -> None:
        """Deserialize fuzzy index data."""
        # For now, this is a placeholder since embedding data is complex
        # In a full implementation, we would deserialize embedding vectors
        pass


class SqliteRelatedTermsIndex(interfaces.ITermToRelatedTermsIndex):
    """SQLite-backed implementation of ITermToRelatedTermsIndex combining aliases and fuzzy index."""

    def __init__(self, db: sqlite3.Connection):
        self.db = db
        self._aliases = SqliteRelatedTermsAliases(db)
        self._fuzzy_index = SqliteRelatedTermsFuzzy(db)

    @property
    def aliases(self) -> interfaces.ITermToRelatedTerms:
        return self._aliases

    @property
    def fuzzy_index(self) -> interfaces.ITermToRelatedTermsFuzzy | None:
        return self._fuzzy_index

    def serialize(self) -> interfaces.TermsToRelatedTermsIndexData:
        """Serialize is not needed for SQLite-backed implementation."""
        # Return empty data since persistence is handled by SQLite
        return interfaces.TermsToRelatedTermsIndexData()

    def deserialize(self, data: interfaces.TermsToRelatedTermsIndexData) -> None:
        """Deserialize related terms index data."""
        # Deserialize alias data
        alias_data = data.get("aliasData")
        if alias_data is not None:
            import asyncio
            asyncio.create_task(self._aliases.deserialize(alias_data))

        # Deserialize fuzzy index data
        text_embedding_data = data.get("textEmbeddingData")
        if text_embedding_data is not None:
            import asyncio
            asyncio.create_task(self._fuzzy_index.deserialize(text_embedding_data))
