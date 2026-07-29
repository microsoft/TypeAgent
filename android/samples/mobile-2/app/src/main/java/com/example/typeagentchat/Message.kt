package com.example.typeagentchat

import java.util.UUID

data class Message(
    val id: String = UUID.randomUUID().toString(),
    val text: String,
    val format: MessageFormat = MessageFormat.TEXT,
    val isUser: Boolean,
    val requestId: String? = null,
    val isFinal: Boolean = false
)

enum class MessageFormat {
    TEXT,
    MARKDOWN;

    fun mergeWith(other: MessageFormat): MessageFormat {
        return if (this == MARKDOWN || other == MARKDOWN) {
            MARKDOWN
        } else {
            TEXT
        }
    }
}
