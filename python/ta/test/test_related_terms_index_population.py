#!/usr/bin/env python3

"""Test to verify related terms index population in storage providers."""

import asyncio
import tempfile
import os
import pytest
from typeagent.storage.sqlitestore import SqliteStorageProvider
from typeagent.knowpro.messageindex import MessageTextIndexSettings
from typeagent.knowpro.reltermsindex import RelatedTermIndexSettings, RelatedTermsIndex
from typeagent.aitools.vectorbase import TextEmbeddingIndexSettings
from typeagent.aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
from typeagent.podcasts.podcast import PodcastMessage, PodcastMessageMeta
from typeagent.knowpro import kplib
from typeagent.knowpro.interfaces import SemanticRef, TextRange, TextLocation
from typeagent.aitools.utils import load_dotenv


@pytest.mark.asyncio
async def test_related_terms_index_population_from_database():
    """Test that related terms index is correctly populated when reopening a database."""
    load_dotenv()
    temp_db_path = tempfile.mktemp(suffix=".sqlite")

    try:
        # Use the test model that's already configured in the system
        embedding_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
        embedding_settings = TextEmbeddingIndexSettings(embedding_model)
        message_text_settings = MessageTextIndexSettings(embedding_settings)
        related_terms_settings = RelatedTermIndexSettings(embedding_settings)

        # Create and populate database
        storage1 = await SqliteStorageProvider.create(
            message_text_settings,
            related_terms_settings,
            temp_db_path,
            PodcastMessage,
        )

        # Add test messages
        test_messages = [
            PodcastMessage(
                text_chunks=["Hello, I'm discussing artificial intelligence today."],
                metadata=PodcastMessageMeta(speaker="Alice"),
            ),
            PodcastMessage(
                text_chunks=["Let me explain machine learning concepts."],
                metadata=PodcastMessageMeta(speaker="Bob"),
            ),
            PodcastMessage(
                text_chunks=["Python is a great programming language."],
                metadata=PodcastMessageMeta(speaker="Charlie"),
            ),
        ]

        msg_collection = await storage1.get_message_collection()
        for message in test_messages:
            await msg_collection.append(message)

        # Add some semantic refs to create terms for the related terms index
        sem_ref_collection = await storage1.get_semantic_ref_collection()

        # Add some entities
        entity_refs = [
            SemanticRef(
                semantic_ref_ordinal=0,
                range=TextRange(start=TextLocation(message_ordinal=0, chunk_ordinal=0)),
                knowledge=kplib.ConcreteEntity(
                    name="artificial intelligence", type=["technology", "concept"]
                ),
            ),
            SemanticRef(
                semantic_ref_ordinal=1,
                range=TextRange(start=TextLocation(message_ordinal=1, chunk_ordinal=0)),
                knowledge=kplib.ConcreteEntity(
                    name="machine learning", type=["technology", "subset of AI"]
                ),
            ),
            SemanticRef(
                semantic_ref_ordinal=2,
                range=TextRange(start=TextLocation(message_ordinal=2, chunk_ordinal=0)),
                knowledge=kplib.ConcreteEntity(
                    name="Python", type=["programming language"]
                ),
            ),
        ]

        for sem_ref in entity_refs:
            await sem_ref_collection.append(sem_ref)

        await storage1.close()

        # Reopen database and verify related terms index
        storage2 = await SqliteStorageProvider.create(
            message_text_settings,
            related_terms_settings,
            temp_db_path,
            PodcastMessage,
        )

        # Check message collection size
        msg_collection2 = await storage2.get_message_collection()
        msg_count = await msg_collection2.size()
        print(f"Message collection size: {msg_count}")
        assert msg_count == len(
            test_messages
        ), f"Expected {len(test_messages)} messages, got {msg_count}"

        # Check semantic ref collection size
        sem_ref_collection2 = await storage2.get_semantic_ref_collection()
        sem_ref_count = await sem_ref_collection2.size()
        print(f"Semantic ref collection size: {sem_ref_count}")
        assert sem_ref_count == len(
            entity_refs
        ), f"Expected {len(entity_refs)} semantic refs, got {sem_ref_count}"

        # Check related terms index
        related_terms_index = await storage2.get_related_terms_index()
        assert isinstance(related_terms_index, RelatedTermsIndex)

        # Check if fuzzy index has entries
        fuzzy_index = related_terms_index.fuzzy_index
        assert fuzzy_index is not None

        fuzzy_index_size = await fuzzy_index.size()
        print(f"Related terms fuzzy index size: {fuzzy_index_size}")

        # The fuzzy index should have entries for all the terms that were added to the conversation index
        # This includes entity names and their types
        assert (
            fuzzy_index_size > 0
        ), f"Related terms fuzzy index should have entries, got {fuzzy_index_size}"

        # We expect terms like: "artificial intelligence", "technology", "concept", "machine learning",
        # "subset of AI", "Python", "programming language"
        # So at least 7 unique terms
        expected_min_terms = 7
        assert (
            fuzzy_index_size >= expected_min_terms
        ), f"Expected at least {expected_min_terms} terms in fuzzy index, got {fuzzy_index_size}"

        print(
            f"✓ Related terms index successfully populated with {fuzzy_index_size} terms"
        )

        await storage2.close()

        print("✅ Related terms index population test passed!")

    finally:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)


if __name__ == "__main__":
    asyncio.run(test_related_terms_index_population_from_database())
