# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import sys
import os

from fixtures import needs_auth
from typeagent.podcasts.podcast import Podcast
from typeagent.knowpro import importing
from typeagent.knowpro.interfaces import Datetime
from typeagent.podcasts.podcast_import import import_podcast
from typeagent.knowpro.serialization import DATA_FILE_SUFFIX, EMBEDDING_FILE_SUFFIX


def on_knowledge_extracted(chunk, knowledge_result) -> bool:
    print("Knowledge extracted:", chunk, "\n    ", knowledge_result)
    return True


def on_embeddings_created(source_texts, batch, batch_start_at) -> bool:
    print("Embeddings extracted:", source_texts)
    return True


def on_text_indexed(text_and_locations, batch, batch_start_at) -> bool:
    print("Text indexed:", text_and_locations)
    return True


def on_message_started(message_order) -> bool:
    print("\nMESSAGE STARTED:", message_order)
    return True


def test_import_podcast(needs_auth):
    # Import the podcast
    settings = importing.ConversationSettings()
    pod = import_podcast(
        "testdata/Episode_53_AdrianTchaikovsky_index",
        None,
        Datetime.now(),
        3.0,
        settings=settings,
    )

    # Basic assertions about the imported podcast
    assert pod.name_tag is not None
    assert len(pod.tags) > 0
    assert len(pod.messages) > 0

    # Build the index
    handler = importing.IndexingEventHandlers(
        on_knowledge_extracted,
        on_embeddings_created,
        on_text_indexed,
        on_message_started,
    )

    indexing_result = asyncio.run(pod.build_index(handler))
    assert indexing_result.semantic_refs is not None
    assert indexing_result.semantic_refs.error is None

    # Serialize and verify
    filename = "podcast"
    pod.write_to_file(filename)

    # Verify the files were created
    assert os.path.exists(f"{filename}{DATA_FILE_SUFFIX}")
    assert os.path.exists(f"{filename}{EMBEDDING_FILE_SUFFIX}")

    # Load and verify the podcast
    pod2 = Podcast(settings=pod.settings)
    pod2.read_from_file(filename)

    # Verify the loaded podcast matches the original
    ser1 = pod.serialize()
    ser2 = pod2.serialize()
    assert ser1 == ser2, "Serialized data does not match original"

    # Clean up test files
    os.remove(f"{filename}{DATA_FILE_SUFFIX}")
    os.remove(f"{filename}{EMBEDDING_FILE_SUFFIX}")
