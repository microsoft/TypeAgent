# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass
import json
import os
from typing import TypedDict, cast, Any

import numpy as np
from pydantic.dataclasses import dataclass as pydantic_dataclass
from pydantic import Field, AliasChoices

from ..aitools.embeddings import NormalizedEmbeddings
from ..storage.memory import semrefindex
from ..knowpro import kplib, secindex
from ..knowpro.field_helpers import CamelCaseField
from ..storage.memory.convthreads import ConversationThreads
from ..knowpro.convsettings import ConversationSettings
from ..knowpro.interfaces import (
    ConversationDataWithIndexes,
    Datetime,
    ICollection,
    IConversation,
    IConversationSecondaryIndexes,
    IKnowledgeSource,
    IMessage,
    IMessageCollection,
    IMessageMetadata,
    ISemanticRefCollection,
    IStorageProvider,
    ITermToSemanticRefIndex,
    MessageOrdinal,
    SemanticRef,
    Term,
    Timedelta,
)
from ..storage.memory.messageindex import MessageTextIndex
from ..storage.memory.reltermsindex import TermToRelatedTermsMap
from ..storage.utils import create_storage_provider
from ..knowpro import serialization
from ..storage.memory.collections import (
    MemoryMessageCollection,
    MemorySemanticRefCollection,
)

@pydantic_dataclass
class EmailMessageMeta(IKnowledgeSource, IMessageMetadata):
    """Metadata for email messages."""
    sender: str
    recipients: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str | None = None

    def get_knowledge(self) -> kplib.KnowledgeResponse:
        # Example implementation, should be replaced with actual knowledge extraction logic
        return kplib.KnowledgeResponse(
            entities=[], actions=[], inverse_actions=[], topics=[]
        )

@pydantic_dataclass
class EmailMessage(IMessage):
    def __init__(self, **data: Any) -> None:
        super().__init__(**data)
    
    text_chunks: list[str] = CamelCaseField("The text chunks of the email message")
    metadata: EmailMessageMeta = CamelCaseField(
        "Metadata associated with the email message"
    )
    tags: list[str] = CamelCaseField(
        "Tags associated with the message", default_factory=list
    )
    timestamp: str | None = None  # Use metadata.sent_on for the actual sent time

    def get_knowledge(self) -> kplib.KnowledgeResponse:
        return self.metadata.get_knowledge()

    def add_timestamp(self, timestamp: str) -> None:
        self.timestamp = timestamp

    def add_content(self, content: str) -> None:
        if self.text_chunks:
            self.text_chunks[0] += content
        else:
            self.text_chunks = [content]

    def serialize(self) -> dict:
        return self.__pydantic_serializer__.to_python(self, by_alias=True)  # type: ignore

    @staticmethod
    def deserialize(message_data: dict) -> "EmailMessage":
        return EmailMessage.__pydantic_validator__.validate_python(message_data)  # type: ignore
    
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
        """Create a fully initialized Podcast instance."""
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
        ), "Use await Podcast.create() to create an initialized instance"
        return self.secondary_indexes
