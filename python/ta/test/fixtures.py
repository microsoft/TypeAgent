# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import tempfile
import os

import pytest
import pytest_asyncio

from typeagent.aitools import utils
from typeagent.aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
from typeagent.aitools.vectorbase import TextEmbeddingIndexSettings
from typeagent.knowpro.messageindex import MessageTextIndexSettings
from typeagent.knowpro.reltermsindex import RelatedTermIndexSettings
from typeagent.knowpro.storage import MemoryStorageProvider
from typeagent.storage.sqlitestore import SqliteStorageProvider


@pytest.fixture(scope="session")
def needs_auth():
    utils.load_dotenv()


@pytest.fixture(scope="session")
def embedding_model():
    """Fixture to create a test embedding model with small embedding size for faster tests."""
    return AsyncEmbeddingModel(model_name=TEST_MODEL_NAME)


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as dir:
        yield dir


@pytest_asyncio.fixture
async def storage(embedding_model):
    """Create a properly configured MemoryStorageProvider for testing."""
    embedding_settings = TextEmbeddingIndexSettings(embedding_model)

    message_text_settings = MessageTextIndexSettings(embedding_settings)
    related_terms_settings = RelatedTermIndexSettings(embedding_settings)

    storage_provider = await MemoryStorageProvider.create(
        message_text_settings=message_text_settings,
        related_terms_settings=related_terms_settings,
    )

    return storage_provider


@pytest.fixture
def temp_db_path():
    """Create a temporary SQLite database file for testing."""
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.remove(path)


@pytest_asyncio.fixture
async def memory_storage(embedding_model):
    """Create a MemoryStorageProvider for testing."""
    embedding_settings = TextEmbeddingIndexSettings(embedding_model)
    message_text_settings = MessageTextIndexSettings(embedding_settings)
    related_terms_settings = RelatedTermIndexSettings(embedding_settings)

    return await MemoryStorageProvider.create(
        message_text_settings=message_text_settings,
        related_terms_settings=related_terms_settings,
    )


@pytest_asyncio.fixture
async def sqlite_storage(temp_db_path, embedding_model):
    """Create a SqliteStorageProvider for testing."""
    # Create settings for the provider
    embedding_settings = TextEmbeddingIndexSettings(embedding_model)
    message_text_settings = MessageTextIndexSettings(embedding_settings)
    related_terms_settings = RelatedTermIndexSettings(embedding_settings)

    # Use the create class method which properly initializes the indexes
    provider = await SqliteStorageProvider.create(
        message_text_settings, related_terms_settings, temp_db_path
    )
    yield provider
    await provider.close()


@pytest_asyncio.fixture(params=["memory", "sqlite"])
async def storage_provider_type(request, embedding_model, temp_db_path):
    """Parameterized fixture that provides both memory and sqlite storage providers."""
    embedding_settings = TextEmbeddingIndexSettings(embedding_model)
    message_text_settings = MessageTextIndexSettings(embedding_settings)
    related_terms_settings = RelatedTermIndexSettings(embedding_settings)

    if request.param == "memory":
        provider = await MemoryStorageProvider.create(
            message_text_settings=message_text_settings,
            related_terms_settings=related_terms_settings,
        )
        yield provider, request.param
    elif request.param == "sqlite":
        provider = await SqliteStorageProvider.create(
            message_text_settings, related_terms_settings, temp_db_path
        )
        yield provider, request.param
        await provider.close()
    else:
        raise ValueError(f"Unknown storage provider type: {request.param}")
