# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typing import Protocol

from .interfaces import IConversationThreads, Thread
from ..aitools.embeddings import NormalizedEmbedding
from .fuzzyindex import TextEmbeddingIndex


class IThreadDataItem(Protocol):
    thread: Thread
    embedding: NormalizedEmbedding


class IConversationThreadData[TThreadDataItem: IThreadDataItem](Protocol):
    """Abstract interface for conversation thread data."""

    threads: list[TThreadDataItem] | None = None


class ConversationThreads(IConversationThreads):
    threads: list[Thread]
    embedding_index: TextEmbeddingIndex

    def __init__(self):
        self.threads = []
        self.embedding_index = TextEmbeddingIndex()
