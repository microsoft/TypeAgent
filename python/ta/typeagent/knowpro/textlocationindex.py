# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
from typing import Any, Protocol

from ..aitools.embeddings import NormalizedEmbeddings
from ..aitools.vectorbase import VectorBase
from .importing import TextEmbeddingIndexSettings
from .interfaces import IndexingEventHandlers, ListIndexingResult, TextLocation


@dataclass
class ScoredTextLocation:
    text_location: TextLocation
    score: float


class ITextToTextLocationIndexData(Protocol):
    textLocations: list[TextLocation]
    embeddings: NormalizedEmbeddings


class ITextToTextLocationIndex(Protocol):
    async def add_text_location(
        self, text: str, text_location: TextLocation
    ) -> ListIndexingResult:
        raise NotImplementedError

    async def add_text_locations(
        self,
        text_and_locations: list[tuple[str, TextLocation]],
        event_handler: IndexingEventHandlers | None = None,
    ) -> ListIndexingResult:
        raise NotImplementedError

    async def lookup_text(
        self,
        text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredTextLocation]:
        raise NotImplementedError

    def serialize(self) -> ITextToTextLocationIndexData:
        raise NotImplementedError

    def deserialize(self, data: ITextToTextLocationIndexData) -> None:
        raise NotImplementedError


class TextToTextLocationIndex(ITextToTextLocationIndex):
    def __init__(self, settings: TextEmbeddingIndexSettings):
        self._text_locations: list[TextLocation] = []
        self._vector_base: VectorBase = VectorBase()

    def __len__(self) -> int:
        return len(self._vector_base)

    def __bool__(self) -> bool:
        return True

    def get(self, pos: int, default: TextLocation | None = None) -> TextLocation | None:
        size = len(self._text_locations)
        if -size <= pos < size:
            return self._text_locations[pos]
        return default

    async def add_text_location(
        self, text: str, text_location: TextLocation
    ) -> ListIndexingResult:
        # TODO: Catch errors
        await self._vector_base.add_key(text)
        self._text_locations.append(text_location)
        return ListIndexingResult(1)

    async def add_text_locations(
        self,
        text_and_locations: list[tuple[str, TextLocation]],
        event_handler: IndexingEventHandlers | None = None,
        batch_size: int | None = None,
    ) -> ListIndexingResult:
        # TODO: Honor batch size
        # TODO: Catch errors
        await self._vector_base.add_keys([text for text, _ in text_and_locations])
        self._text_locations.extend([location for _, location in text_and_locations])
        return ListIndexingResult(len(text_and_locations))

    async def lookup_text(
        self,
        text: str,
        max_matches: int | None = None,
        threshold_score: float | None = None,
    ) -> list[ScoredTextLocation]:
        matches = await self._vector_base.fuzzy_lookup(
            text, max_hits=max_matches, min_score=threshold_score
        )
        return [
            ScoredTextLocation(self._text_locations[match.ordinal], match.score)
            for match in matches
        ]

    async def lookup_text_in_subset(
        self,
        *args,
        **kwds,
    ) -> Any:
        raise NotImplementedError

    def serialize(self) -> Any:
        raise NotImplementedError  # TODO implement TextToTextLocationIndex serialization

    def deserialize(self, data: Any) -> None:
        raise NotImplementedError  # TODO: implement TextToTextLocationIndex deserialization
