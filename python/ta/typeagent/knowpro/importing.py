# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from dataclasses import dataclass


@dataclass
class RelatedTermIndexSettings:
    pass  # TODO


@dataclass
class TextEmbeddingIndexSettings:
    pass  # TODO


@dataclass
class MessageTextIndexSettings:
    pass  # TODO


@dataclass
class ConversationSettings:
    related_term_index_settings: RelatedTermIndexSettings
    thread_settings: TextEmbeddingIndexSettings
    message_text_index_settings: MessageTextIndexSettings


def create_conversation_settings() -> ConversationSettings:
    # TODO
    return ConversationSettings(
        RelatedTermIndexSettings(),
        TextEmbeddingIndexSettings(),
        MessageTextIndexSettings(),
    )
