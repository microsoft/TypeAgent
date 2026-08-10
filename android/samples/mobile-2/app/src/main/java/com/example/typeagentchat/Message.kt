package com.example.typeagentchat

import java.util.UUID

data class Message(
    val id: String = UUID.randomUUID().toString(),
    val segments: List<MessageSegment>,
    val isUser: Boolean,
    val requestId: String? = null,
    val isFinal: Boolean = false,
    /**
     * When the message was created, as epoch milliseconds. Persisted so stored
     * transcripts can be aged out - see [ChatSessionSerializer.MAX_MESSAGE_AGE_MILLIS].
     */
    val timestampMillis: Long = System.currentTimeMillis()
) {
    constructor(
        text: String,
        format: MessageFormat = MessageFormat.TEXT,
        isUser: Boolean,
        requestId: String? = null,
        isFinal: Boolean = false,
        timestampMillis: Long = System.currentTimeMillis()
    ) : this(
        segments = listOf(MessageSegment(text = text, format = format)),
        isUser = isUser,
        requestId = requestId,
        isFinal = isFinal,
        timestampMillis = timestampMillis
    )

    val text: String
        get() = segments.joinToString("\n\n") { it.text }

    val format: MessageFormat
        get() = segments.fold(MessageFormat.TEXT) { acc, segment ->
            acc.mergeWith(segment.format)
        }
}

/**
 * Mirrors TypeAgent's `DisplayMessageKind` from `@typeagent/agent-sdk`. The
 * shell turns this into a `chat-message-kind-<kind>` CSS class so routing
 * annotations such as "routed to list - recent topic" render de-emphasised
 * next to the actual answer.
 */
enum class MessageKind {
    NONE,
    INFO,
    STATUS,
    WARNING,
    ERROR,
    SUCCESS;

    val isSecondary: Boolean
        get() = this == INFO || this == STATUS

    companion object {
        fun parse(raw: String?): MessageKind {
            return when (raw?.trim()?.lowercase()) {
                "info" -> INFO
                "status" -> STATUS
                "warning" -> WARNING
                "error" -> ERROR
                "success" -> SUCCESS
                else -> NONE
            }
        }
    }
}

/**
 * One rendered block inside a chat bubble, equivalent to a single content
 * `<div>` the shell appends to `.chat-message-content`.
 */
data class MessageSegment(
    val text: String,
    val format: MessageFormat = MessageFormat.TEXT,
    val kind: MessageKind = MessageKind.NONE
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
