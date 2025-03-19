# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from .importing import ConversationSettings
from .interfaces import IConversation, IndexingEventHandlers, IndexingResults


class ConversationSecondaryIndexes:
    def __init__(self, settings: dict = None):
        if settings is None:
            settings = {}
        # self.property_to_semantic_ref_index = PropertyIndex()
        # self.timestamp_index = TimestampToTextRangeIndex()
        # self.term_to_related_terms_index = RelatedTermsIndex(settings)


async def build_secondary_index(
    conversation: IConversation,
    conversation_settings: ConversationSettings,
    event_handler: IndexingEventHandlers,
) -> SecondaryIndexingResults:
    results = SecondaryIndexingResults()
    return results
