# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Storage provider utilities.

This module provides utility functions for creating storage providers
without circular import issues.
"""

from typeagent.knowpro import interfaces


async def get_storage_provider(
    dbname: str | None = None,
) -> interfaces.IStorageProvider:
    """
    Create a storage provider - MemoryStorageProvider if dbname is None,
    SqliteStorageProvider otherwise.
    """
    if dbname is None:
        # Create MemoryStorageProvider with test-friendly settings
        from ..aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
        from ..aitools.vectorbase import TextEmbeddingIndexSettings
        from ..knowpro.messageindex import MessageTextIndexSettings
        from ..knowpro.reltermsindex import RelatedTermIndexSettings
        from ..knowpro.storage import MemoryStorageProvider

        test_model = AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)
        embedding_settings = TextEmbeddingIndexSettings(test_model)
        message_text_settings = MessageTextIndexSettings(embedding_settings)
        related_terms_settings = RelatedTermIndexSettings(embedding_settings)

        return await MemoryStorageProvider.create(
            message_text_settings, related_terms_settings
        )
    else:
        from .sqlitestore import SqliteStorageProvider

        return await SqliteStorageProvider.create(dbname)
