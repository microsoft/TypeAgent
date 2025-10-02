# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass

from pydantic.dataclasses import dataclass as pydantic_dataclass

from ..knowpro import secindex
from ..knowpro.convsettings import ConversationSettings
from ..knowpro.interfaces import (
    IConversation,
    IConversationSecondaryIndexes,
    IMessageCollection,
    ISemanticRefCollection,
    ITermToSemanticRefIndex,
)
    
from .email_message import EmailMessage

@dataclass
class EmailMemory(IConversation[EmailMessage, ITermToSemanticRefIndex]):
    settings: ConversationSettings
    name_tag: str
    messages: IMessageCollection[EmailMessage]
    semantic_refs: ISemanticRefCollection
    tags: list[str]
    semantic_ref_index: ITermToSemanticRefIndex
    secondary_indexes: IConversationSecondaryIndexes[EmailMessage] | None

    @classmethod
    async def create(
        cls,
        settings: ConversationSettings,
        name_tag: str | None = None,
        messages: IMessageCollection[EmailMessage] | None = None,
        semantic_refs: ISemanticRefCollection | None = None,
        semantic_ref_index: ITermToSemanticRefIndex | None = None,
        tags: list[str] | None = None,
        secondary_indexes: IConversationSecondaryIndexes[EmailMessage] | None = None,
    ) -> "EmailMemory":

        storage_provider = await settings.get_storage_provider()
        return cls(
            settings,
            name_tag or "",
            messages or await storage_provider.get_message_collection(),
            semantic_refs or await storage_provider.get_semantic_ref_collection(),
            tags if tags is not None else [],
            semantic_ref_index or await storage_provider.get_semantic_ref_index(),
            secondary_indexes
            or await secindex.ConversationSecondaryIndexes.create(
                storage_provider, settings.related_term_index_settings
            ),
        )

    def _get_secondary_indexes(self) -> IConversationSecondaryIndexes[EmailMessage]:
        """Get secondary indexes, asserting they are initialized."""
        assert (
            self.secondary_indexes is not None
        ), "Use await f.create() to create an initialized instance"
        return self.secondary_indexes
