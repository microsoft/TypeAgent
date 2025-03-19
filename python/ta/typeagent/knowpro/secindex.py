# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from typing import Any

from .importing import ConversationSettings
from .interfaces import (
    IConversation,
    IConversationSecondaryIndexes,
    IMessage,
    ITermToSemanticRefIndex,
    IndexingEventHandlers,
    SecondaryIndexingResults,
)


class ConversationSecondaryIndexes(IConversationSecondaryIndexes):
    # TODO: settings is probably not a dict
    def __init__(self, settings: dict[str, Any] | None = None):
        if settings is None:
            settings = {}
        # TODO: Put in real values.
        self.property_to_semantic_ref_index = None  # PropertyIndex()
        self.timestamp_index = None  # TimestampToTextRangeIndex()
        self.term_to_related_terms_index = None  # RelatedTermsIndex(settings)
        self.threads = None  # ThreadIndex(settings)
        self.message_index = None


async def build_secondary_indexes[
    TM: IMessage,
    TT: ITermToSemanticRefIndex,
](
    conversation: IConversation[TM, TT, ConversationSecondaryIndexes],
    conversation_settings: ConversationSettings,
    event_handler: IndexingEventHandlers | None,
) -> SecondaryIndexingResults:
    if conversation.secondary_indexes is None:
        conversation.secondary_indexes = ConversationSecondaryIndexes()
    result: SecondaryIndexingResults = build_transient_secondary_indexes(
        conversation,  # type: ignore  # TODO
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


def build_transient_secondary_indexes[
    TM: IMessage, TT: ITermToSemanticRefIndex, TC: IConversationSecondaryIndexes
](
    conversation: IConversation[TM, TT, TC],
) -> SecondaryIndexingResults:
    if conversation.secondary_indexes is None:
        conversation.secondary_indexes = ConversationSecondaryIndexes()  # type: ignore  # TODO
    result = SecondaryIndexingResults()
    # TODO
    # result.properties = build_property_index(conversation)
    # result.timestamps = build_timestamp_index(conversation)
    return result
