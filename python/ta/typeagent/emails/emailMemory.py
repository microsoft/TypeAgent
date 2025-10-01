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
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str | None = None
    sent_on: Datetime | None = None
    received_on: Datetime | None = None
    importance: str | None = None

    def get_knowledge(self) -> kplib.KnowledgeResponse:
        # Example implementation, should be replaced with actual knowledge extraction logic
        return kplib.KnowledgeResponse(
            entities=[], actions=[], inverse_actions=[], topics=[]
        )

@pydantic_dataclass
class EmailMessageMeta(IKnowledgeSource, IMessageMetadata):
    """Metadata for email messages."""
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str | None = None
    sent_on: Datetime | None = None
    received_on: Datetime | None = None
    importance: str | None = None

@pydantic_dataclass
class EmailMessage(IMessage):
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
