# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
from dataclasses import dataclass
import json

from pydantic.dataclasses import dataclass as pydantic_dataclass

from ..knowpro import secindex
from ..knowpro.convsettings import ConversationSettings
from ..knowpro.interfaces import (
    IConversation,
    IConversationSecondaryIndexes,
    IMessageCollection,
    ISemanticRefCollection,
    ITermToSemanticRefIndex,
    Term,
)
from ..storage.memory import semrefindex
        
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

    @staticmethod
    def create_settings() -> ConversationSettings:
        settings = ConversationSettings()
        settings.semantic_ref_index_settings.auto_extract_knowledge = True
        return settings
    
    async def add_message(self, message: EmailMessage) -> None:    
        await self.messages.append(message)

    async def build_index(
        self,
    ) -> None:
        await semrefindex.add_metadata_to_index(
            self.messages,
            self.semantic_refs,
            self.semantic_ref_index,
        )
        assert (
            self.settings is not None
        ), "Settings must be initialized before building index"

        await add_synonyms_file_as_aliases(self, "emailVerbs.json")  
        await semrefindex.build_semantic_ref(self, self.settings)
        await secindex.build_transient_secondary_indexes(self, self.settings)
       
    def _get_secondary_indexes(self) -> IConversationSecondaryIndexes[EmailMessage]:
        """Get secondary indexes, asserting they are initialized."""
        assert (
            self.secondary_indexes is not None
        ), "Use await f.create() to create an initialized instance"
        return self.secondary_indexes


async def add_synonyms_file_as_aliases(conversation: IConversation, file_name: str) -> None:
    secondary_indexes = conversation.secondary_indexes
    assert secondary_indexes is not None
    assert secondary_indexes.term_to_related_terms_index is not None

    aliases = secondary_indexes.term_to_related_terms_index.aliases
    synonym_file = os.path.join(os.path.dirname(__file__), file_name)
    with open(synonym_file) as f:
        data: list[dict] = json.load(f)
    if data:
        for obj in data:
            text = obj.get("term")
            synonyms = obj.get("relatedTerms")
            if text and synonyms:
                related_term = Term(text=text.lower())
                for synonym in synonyms:
                    await aliases.add_related_term(synonym.lower(), related_term)
