# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Storage providers and implementations."""

# Import from new organized structure
from .memory import (
    MemoryStorageProvider,
    MemoryMessageCollection,
    MemorySemanticRefCollection,
)
from .sqlite import (
    SqliteStorageProvider,
    SqliteMessageCollection,
    SqliteSemanticRefCollection,
)

# Keep legacy import for backward compatibility during transition
from .sqlitestore import SqliteStorageProvider as LegacySqliteStorageProvider

__all__ = [
    "MemoryStorageProvider",
    "MemoryMessageCollection",
    "MemorySemanticRefCollection",
    "SqliteStorageProvider",
    "SqliteMessageCollection",
    "SqliteSemanticRefCollection",
    "LegacySqliteStorageProvider",  # Temporary for migration
]
