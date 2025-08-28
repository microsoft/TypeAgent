# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import pytest
import pytest_asyncio
from typeagent.knowpro.reltermsindex import (
    TermToRelatedTermsMap,
    RelatedTermsIndex,
    RelatedTermIndexSettings,
    build_related_terms_index,
    dedupe_related_terms,
)
from typeagent.aitools.vectorbase import TextEmbeddingIndexSettings
from typeagent.storage.memorystore import MemoryStorageProvider
from typeagent.storage.sqlitestore import SqliteStorageProvider
from typeagent.knowpro.interfaces import Term
from fixtures import needs_auth, embedding_model, temp_db_path


import pytest_asyncio


@pytest_asyncio.fixture(params=["memory", "sqlite"])
async def related_terms_index(request, embedding_model, temp_db_path):
    from typeagent.knowpro.messageindex import MessageTextIndexSettings
    from typeagent.knowpro.interfaces import IMessage

    class DummyTestMessage(IMessage):
        text_chunks: list[str]
        tags: list[str] = []

        def get_knowledge(self):
            from typeagent.knowpro.kplib import KnowledgeResponse

            return KnowledgeResponse(
                entities=[], actions=[], inverse_actions=[], topics=[]
            )

    embedding_settings = TextEmbeddingIndexSettings(embedding_model)
    message_text_settings = MessageTextIndexSettings(embedding_settings)
    related_terms_settings = RelatedTermIndexSettings(embedding_settings)
    if request.param == "memory":
        provider = MemoryStorageProvider(
            message_text_settings=message_text_settings,
            related_terms_settings=related_terms_settings,
        )
        index = await provider.get_related_terms_index()
        yield index
    else:
        provider = await SqliteStorageProvider.create(
            message_text_settings,
            related_terms_settings,
            temp_db_path,
            DummyTestMessage,
        )
        index = await provider.get_related_terms_index()
        yield index
        await provider.close()


@pytest.mark.asyncio
async def test_add_and_lookup_related_term(related_terms_index, needs_auth):
    await related_terms_index.aliases.add_related_term(
        "python", Term(text="programming")
    )
    await related_terms_index.aliases.add_related_term("python", Term(text="snake"))
    result = await related_terms_index.aliases.lookup_term("python")
    assert result is not None
    assert len(result) == 2
    assert any(term.text == "programming" for term in result)
    assert any(term.text == "snake" for term in result)


@pytest.mark.asyncio
async def test_remove_term(related_terms_index, needs_auth):
    await related_terms_index.aliases.add_related_term(
        "python", Term(text="programming")
    )
    await related_terms_index.aliases.remove_term("python")
    result = await related_terms_index.aliases.lookup_term("python")
    assert result is None or len(result) == 0


@pytest.mark.asyncio
async def test_clear_and_size(related_terms_index, needs_auth):
    await related_terms_index.aliases.add_related_term(
        "python", Term(text="programming")
    )
    await related_terms_index.aliases.add_related_term("java", Term(text="coffee"))
    await related_terms_index.aliases.clear()
    size = await related_terms_index.aliases.size()
    assert size == 0


@pytest.mark.asyncio
async def test_serialize_and_deserialize(related_terms_index, needs_auth):
    await related_terms_index.aliases.add_related_term(
        "python", Term(text="programming")
    )
    data = await related_terms_index.aliases.serialize()
    await related_terms_index.aliases.clear()
    await related_terms_index.aliases.deserialize(data)
    result = await related_terms_index.aliases.lookup_term("python")
    assert result is not None
    assert any(term.text == "programming" for term in result)


@pytest.mark.asyncio
async def test_related_terms_index_basic(needs_auth):
    settings = RelatedTermIndexSettings(TextEmbeddingIndexSettings())
    index = RelatedTermsIndex(settings)
    assert isinstance(index.aliases, TermToRelatedTermsMap)
    assert index.fuzzy_index is not None
    data = await index.serialize()
    await index.deserialize(data)
    assert isinstance(index.aliases, TermToRelatedTermsMap)


# Add more tests for build_related_terms_index and dedupe_related_terms as needed
