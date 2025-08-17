# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import tempfile

import pytest
import pytest_asyncio

from typeagent.aitools import utils
from typeagent.aitools.embeddings import AsyncEmbeddingModel, TEST_MODEL_NAME
from typeagent.aitools.vectorbase import TextEmbeddingIndexSettings
from typeagent.knowpro.importing import (
    MessageTextIndexSettings,
    RelatedTermIndexSettings,
)
from typeagent.knowpro.storage import MemoryStorageProvider


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
