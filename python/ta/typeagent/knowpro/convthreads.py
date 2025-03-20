# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typing import Protocol

from .interfaces import IConversationThreads, ScoredThreadOrdinal, Thread
from ..aitools.embeddings import NormalizedEmbedding
from ..aitools.vectorbase import VectorBase


class IThreadDataItem(Protocol):
    thread: Thread
    embedding: NormalizedEmbedding


class IConversationThreadData[TThreadDataItem: IThreadDataItem](Protocol):
    """Abstract interface for conversation thread data."""

    threads: list[TThreadDataItem] | None = None


class ConversationThreads(IConversationThreads):
    threads: list[Thread]
    vector_base: VectorBase

    def __init__(self):  # TODO: TextEmbeddingIndexSettings
        self.threads = []
        self.vector_base = VectorBase()

    async def add_thread(self, thread: Thread) -> None:
        assert len(self.threads) == len(self.vector_base)
        await self.vector_base.add_key(thread.description)
        self.threads.append(thread)

    async def lookup_thread(
        self,
        thread_description: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredThreadOrdinal]:
        matches = await self.vector_base.fuzzy_lookup(
            thread_description,
            max_matches,
            threshold_score,
        )
        return [
            ScoredThreadOrdinal(
                match.ordinal,
                match.score,
            )
            for match in matches
        ]
