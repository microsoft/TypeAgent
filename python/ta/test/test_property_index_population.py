#!/usr/bin/env python3

"""Test to verify property index population in storage providers."""

import asyncio
import tempfile
import os
import pytest
from typeagent.storage.sqlitestore import SqliteStorageProvider
from typeagent.knowpro.propindex import PropertyIndex
from typeagent.knowpro import kplib
from typeagent.knowpro.interfaces import Tag, SemanticRef, TextRange, TextLocation
from typeagent.knowpro.messageindex import MessageTextIndexSettings
from typeagent.knowpro.reltermsindex import RelatedTermIndexSettings
from typeagent.aitools.vectorbase import TextEmbeddingIndexSettings
from typeagent.aitools.embeddings import AsyncEmbeddingModel
from typeagent.podcasts.podcast import PodcastMessage, PodcastMessageMeta
from typeagent.aitools.utils import load_dotenv
import numpy as np


class MockEmbeddingModel(AsyncEmbeddingModel):
    @property
    def dimension(self) -> int:
        return 384

    async def get_embeddings(self, keys: list[str]) -> np.ndarray:
        result = np.random.rand(len(keys), 384).astype(np.float32)
        norms = np.linalg.norm(result, axis=1, keepdims=True)
        return result / norms


@pytest.mark.asyncio
async def test_property_index_population_from_database():
    """Test that property index is correctly populated when reopening a database."""
    load_dotenv()
    temp_db_path = tempfile.mktemp(suffix=".sqlite")

    try:
        embedding_model = MockEmbeddingModel()
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

        # Add test semantic refs with all knowledge types
        location = TextLocation(message_ordinal=0)
        text_range = TextRange(start=location)

        test_data = [
            # Entity with facets
            SemanticRef(
                semantic_ref_ordinal=0,
                range=text_range,
                knowledge=kplib.ConcreteEntity(
                    name="John Doe",
                    type=["person", "speaker"],
                    facets=[kplib.Facet(name="role", value="host")],
                ),
            ),
            # Action
            SemanticRef(
                semantic_ref_ordinal=1,
                range=text_range,
                knowledge=kplib.Action(
                    verbs=["discuss", "explain"],
                    verb_tense="present",
                    subject_entity_name="John Doe",
                    object_entity_name="technology",
                    indirect_object_entity_name="audience",
                ),
            ),
            # Tag
            SemanticRef(
                semantic_ref_ordinal=2,
                range=text_range,
                knowledge=Tag(text="interview"),
            ),
        ]

        sem_ref_collection = await storage1.get_semantic_ref_collection()
        for sem_ref in test_data:
            await sem_ref_collection.append(sem_ref)

        await storage1.close()

        # Reopen database and verify property index
        storage2 = await SqliteStorageProvider.create(
            message_text_settings,
            related_terms_settings,
            temp_db_path,
            PodcastMessage,
        )

        prop_index = await storage2.get_property_index()
        assert isinstance(prop_index, PropertyIndex)

        # Verify property index is populated
        prop_size = await prop_index.size()
        assert prop_size > 0, "Property index should not be empty"

        # Test entity properties
        name_lookup = await prop_index.lookup_property("name", "john doe")
        assert (
            name_lookup is not None and len(name_lookup) > 0
        ), "Entity name should be indexed"

        type_lookup = await prop_index.lookup_property("type", "person")
        assert (
            type_lookup is not None and len(type_lookup) > 0
        ), "Entity type should be indexed"

        facet_name_lookup = await prop_index.lookup_property("facet.name", "role")
        assert (
            facet_name_lookup is not None and len(facet_name_lookup) > 0
        ), "Facet name should be indexed"

        facet_value_lookup = await prop_index.lookup_property("facet.value", "host")
        assert (
            facet_value_lookup is not None and len(facet_value_lookup) > 0
        ), "Facet value should be indexed"

        # Test action properties
        verb_lookup = await prop_index.lookup_property("verb", "discuss explain")
        assert (
            verb_lookup is not None and len(verb_lookup) > 0
        ), "Action verbs should be indexed"

        subject_lookup = await prop_index.lookup_property("subject", "john doe")
        assert (
            subject_lookup is not None and len(subject_lookup) > 0
        ), "Action subject should be indexed"

        object_lookup = await prop_index.lookup_property("object", "technology")
        assert (
            object_lookup is not None and len(object_lookup) > 0
        ), "Action object should be indexed"

        indirect_object_lookup = await prop_index.lookup_property(
            "indirectobject", "audience"
        )
        assert (
            indirect_object_lookup is not None and len(indirect_object_lookup) > 0
        ), "Action indirect object should be indexed"

        # Test tag properties
        tag_lookup = await prop_index.lookup_property("tag", "interview")
        assert tag_lookup is not None and len(tag_lookup) > 0, "Tag should be indexed"

        await storage2.close()

        print("✅ All property index population tests passed!")

    finally:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)


if __name__ == "__main__":
    asyncio.run(test_property_index_population_from_database())
