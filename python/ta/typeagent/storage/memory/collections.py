# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Memory-based collection implementations."""

from typing import Iterable
from ..base.collections import BaseCollection, BaseSemanticRefCollection, BaseMessageCollection
from ...knowpro.interfaces import (
    IMessage,
    MessageOrdinal,
    SemanticRef,
    SemanticRefOrdinal,
)


class MemoryCollection[T, TOrdinal: int](BaseCollection[T, TOrdinal]):
    """A generic in-memory (non-persistent) collection class."""

    @property
    def is_persistent(self) -> bool:
        return False


class MemorySemanticRefCollection(MemoryCollection[SemanticRef, SemanticRefOrdinal]):
    """A collection of semantic references."""


class MemoryMessageCollection[TMessage: IMessage](
    MemoryCollection[TMessage, MessageOrdinal]
):
    """A collection of messages."""
