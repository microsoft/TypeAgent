# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from .importing import ConversationSettings
from .interfaces import IConversation, IndexingEventHandlers, SecondaryIndexingResults


class ConversationSecondaryIndexes:
    def __init__(self, settings: dict = None):
        if settings is None:
            settings = {}
        # TODO
        # self.property_to_semantic_ref_index = PropertyIndex()
        # self.timestamp_index = TimestampToTextRangeIndex()
        # self.term_to_related_terms_index = RelatedTermsIndex(settings)


async def build_secondary_index(
    conversation: IConversation,
    conversation_settings: ConversationSettings,
    event_handler: IndexingEventHandlers,
) -> SecondaryIndexingResults:
    if conversation.secondary_indexes is None:
        conversation.secondary_indexes = ConversationSecondaryIndexes()
    result: SecondaryIndexingResults = build_transient_secondary_indexes(
        conversation,
    )
    # TODO
    # result.related_terms = await build_related_terms_index(
    #     conversation, conversation_settings, event_handler
    # )
    # if result.related_terms is not None and not result.related_terms.error:
    #         result.message = await build_message_index(
    #              conversation,
    #              conversation_settings.message_text_index_settings,
    #              event_handler,
    #         )

    return result


def build_transient_secondary_indexes(
    conversation: IConversation,
) -> SecondaryIndexingResults:
    if conversation.secondary_indexes is None:
        conversation.secondary_indexes = ConversationSecondaryIndexes()
    result = SecondaryIndexingResults()
    # TODO
    # result.properties = build_property_index(conversation)
    # result.timestamps = build_timestamp_index(conversation)
    return result


