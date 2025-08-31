# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Base storage classes and interfaces."""

from .collections import BaseCollection
from .provider import BaseStorageProvider

__all__ = ["BaseCollection", "BaseStorageProvider"]
