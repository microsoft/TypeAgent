# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
from typing import Any, NamedTuple, TypedDict, cast

import numpy as np
from numpy.typing import NDArray

from .embeddings import AsyncEmbeddingModel, NormalizedEmbedding, NormalizedEmbeddings


@dataclass
class TextEmbeddingIndexSettings:
    embedding_model: AsyncEmbeddingModel | None = None
    embedding_size: int | None = None
    min_score: float = 0.0
    max_matches: int | None = None
    retry_max_attempts: int = 2
    retry_delay: float = 2.0  # Seconds
    batch_size: int = 8

    def __init__(
        self,
        embedding_model: AsyncEmbeddingModel | None = None,
        embedding_size: int | None = None,
        min_score: float | None = None,
        max_matches: int | None = None,
    ):
        if embedding_model is None:
            embedding_model = AsyncEmbeddingModel()
        self.embedding_model = embedding_model
        self.embedding_size = embedding_size
        if min_score is None:
            min_score = 0.85
        self.min_score = min_score
        self.max_matches = max_matches


class ScoredOrdinal(NamedTuple):
    ordinal: int
    score: float


class ITextEmbeddingIndexData(TypedDict):
    embeddings: NormalizedEmbeddings | None


class VectorBase:
    def __init__(self, settings: TextEmbeddingIndexSettings | None = None):
        model = settings.embedding_model if settings is not None else None
        if model is None:
            model = AsyncEmbeddingModel()
        self._model = model
        # TODO: Using Any b/c pyright doesn't appear to understand NDArray.
        self._vectors: NormalizedEmbeddings | None = None

    async def get_embedding(self, key: str, cache: bool = True) -> NormalizedEmbedding:
        if cache:
            return await self._model.get_embedding(key)
        else:
            return await self._model.get_embedding_nocache(key)

    async def get_embeddings(
        self, keys: list[str], cache: bool = True
    ) -> NormalizedEmbeddings:
        if cache:
            return await self._model.get_embeddings(keys)
        else:
            return await self._model.get_embeddings_nocache(keys)

    def __len__(self) -> int:
        return len(self._vectors) if self._vectors is not None else 0

    # Needed because otherwise an empty index would be falsy.
    def __bool__(self) -> bool:
        return True

    async def add_key(self, key: str, cache: bool = True) -> None:
        embedding = (await self.get_embedding(key)).reshape((1, -1))
        if self._vectors is None:
            self._vectors = embedding
        else:
            self._vectors = np.append(self._vectors, embedding, axis=0)

    async def add_keys(self, keys: list[str], cache: bool = True) -> None:
        embeddings = await self.get_embeddings(keys, cache=cache)
        if self._vectors is None:
            self._vectors = embeddings
        else:
            self._vectors = np.append(self._vectors, embeddings, axis=0)

    async def fuzzy_lookup(
        self, key: str, max_hits: int | None = None, min_score: float | None = None
    ) -> list[ScoredOrdinal]:
        if self._vectors is None:
            return []
        if max_hits is None:
            max_hits = 10
        if min_score is None:
            min_score = 0.0
        embedding = await self.get_embedding(key)
        scores = np.dot(self._vectors, embedding)  # This does most of the work
        scored_ordinals = [
            ScoredOrdinal(i, score)
            for i, score in enumerate(scores)
            if score >= min_score
        ]
        scored_ordinals.sort(key=lambda x: x.score, reverse=True)
        return scored_ordinals[:max_hits]

    def clear(self) -> None:
        self._vectors = np.array([], dtype=np.float32).reshape((0, 0))

    def serialize_embedding_at(self, ordinal: int) -> NormalizedEmbedding | None:
        return self._vectors[ordinal] if self._vectors is not None else None

    def serialize(self) -> NormalizedEmbeddings | None:
        return self._vectors if self._vectors is not None else None


async def main():
    import dotenv, os, time

    epoch = time.time()

    def log(*args, end="\n"):
        stamp = f"{time.time()-epoch:7.3f}"
        args = list(args)
        for i, arg in enumerate(args):
            if isinstance(arg, str) and "\n" in arg:
                args[i] = arg.replace("\n", f"\n{stamp}: ")
        print(f"{stamp}:", *args, end=end)

    def debugv(heading):
        log(f"{heading}: bool={bool(v)}, len={len(v)}")

    dotenv.load_dotenv(os.path.expanduser("~/TypeAgent/ts/.env"))
    v = VectorBase()
    debugv("\nEmpty vector base")

    words: list[str] = (
        "Mostly about multi-agent frameworks, "
        + "but also about answering questions about podcast transcripts."
    ).split()  # type: ignore  # pyright complains about list[LiteralString] -> list[str]
    cut = 2
    for word in words[:cut]:
        log("\nAdding:", word)
        await v.add_key(word)
        scored_ordinals = await v.fuzzy_lookup(word, max_hits=1)
        assert (
            round(scored_ordinals[0].score, 5) == 1.0
        ), f"{word} scores {scored_ordinals[0]}"
        debugv(word)

    log("\nAdding remaining words")
    await v.add_keys(words[cut:])
    debugv("After adding all")

    log("\nChecking presence")
    for word in words:
        scored_ordinals = await v.fuzzy_lookup(word, max_hits=1)
        assert (
            round(scored_ordinals[0].score, 5) == 1.0
        ), f"{word} scores {scored_ordinals[0]}"
    log("All words are present")
    word = "pancakes"
    scored_ordinals = await v.fuzzy_lookup(word, max_hits=1)
    assert scored_ordinals[0].score < 0.7, f"{word} scores {scored_ordinals[0]}"

    log("\nFuzzy lookups:")
    for word in words + ["pancakes", "hello world", "book", "author"]:
        neighbors = await v.fuzzy_lookup(word, max_hits=3)
        log(f"{word}:", [(nb.ordinal, nb.score) for nb in neighbors])


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
