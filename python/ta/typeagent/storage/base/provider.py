# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Base storage provider interface."""

from typing import Protocol
from ...knowpro.interfaces import (
    IStorageProvider,
    IMessage,
    IMessageCollection,
    ISemanticRefCollection,
    ITermToSemanticRefIndex,
    IPropertyToSemanticRefIndex,
    ITimestampToTextRangeIndex,
    IMessageTextIndex,
    ITermToRelatedTermsIndex,
    IConversationThreads,
)


class BaseStorageProvider[TMessage: IMessage](IStorageProvider[TMessage]):
    """Base storage provider with common functionality."""

    async def get_message_collection(
        self, message_type: type[TMessage] | None = None
    ) -> IMessageCollection[TMessage]:
        """Get the message collection."""
        raise NotImplementedError

    async def get_semantic_ref_collection(self) -> ISemanticRefCollection:
        """Get the semantic reference collection."""
        raise NotImplementedError

    # Index getters
    async def get_semantic_ref_index(self) -> ITermToSemanticRefIndex:
        """Get the semantic reference index."""
        raise NotImplementedError

    async def get_property_index(self) -> IPropertyToSemanticRefIndex:
        """Get the property index."""
        raise NotImplementedError

    async def get_timestamp_index(self) -> ITimestampToTextRangeIndex:
        """Get the timestamp index."""
        raise NotImplementedError

    async def get_message_text_index(self) -> IMessageTextIndex[TMessage]:
        """Get the message text index."""
        raise NotImplementedError

    async def get_related_terms_index(self) -> ITermToRelatedTermsIndex:
        """Get the related terms index."""
        raise NotImplementedError

    async def get_conversation_threads(self) -> IConversationThreads:
        """Get the conversation threads."""
        raise NotImplementedError

    async def close(self) -> None:
        """Close the storage provider."""
        raise NotImplementedError
