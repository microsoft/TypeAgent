# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typing import Any

from ..aitools.embeddings import NormalizedEmbedding


# THIS IS ONE BIG TODO
class TextEmbeddingIndex:
    def __init__(self):
        pass

    def __len__(self):
        return 0
    
    def get(self, pos: int) -> NormalizedEmbedding:
        return [0]*1536  # type: ignore  # TODO
    
    def push(self, embeddings: list[NormalizedEmbedding]):
        pass

    def insert_at(self, ordinal: int, embeddings: list[NormalizedEmbedding]):
        pass

    def get_indexes_of_nearest(
        self,
        embeddings: list[NormalizedEmbedding], 
        max_matches: int = 10,
        max_distance: float = 0.0,
    ) -> list[Any]:
        return []
    
    def get_indexes_of_nearest_in_subset(*args: Any) -> Any:
        return []
    
    def remote_at(self, pos: int) -> None:
        pass

    def clear(self):
        pass

    def serialize(self) -> list[NormalizedEmbedding]:
        x: Any = None
        return x

    def deserialize(self, embeddings: NormalizedEmbedding) -> None:
        pass
