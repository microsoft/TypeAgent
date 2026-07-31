package com.example.typeagentchat

/**
 * Mirrors TypeAgent's `DisplayAppendMode` from `@typeagent/agent-sdk`.
 *
 * `REPLACE` stands in for the `undefined` append mode the shell uses when
 * `ClientIO.setDisplay` is called: it clears everything already rendered for
 * the request before rendering the new content.
 */
internal enum class DisplayAppendMode {
    REPLACE,
    INLINE,
    BLOCK,
    TEMPORARY,
    STEP
}

internal fun parseDisplayAppendMode(raw: String?): DisplayAppendMode {
    return when (raw?.trim()?.lowercase()) {
        "inline" -> DisplayAppendMode.INLINE
        "temporary" -> DisplayAppendMode.TEMPORARY
        "step" -> DisplayAppendMode.STEP
        else -> DisplayAppendMode.BLOCK
    }
}

/**
 * `AgentMessageKind` values that the shell renders outside of the agent bubble.
 */
internal fun isEphemeralAgentMessageKind(kind: String?): Boolean {
    return when (kind?.trim()?.lowercase()) {
        "toast", "inline" -> true
        else -> false
    }
}

internal data class RenderedAgentMessage(
    val segments: List<MessageSegment>
) {
    val text: String
        get() = segments.joinToString("\n\n") { it.text }

    val format: MessageFormat
        get() = segments.fold(MessageFormat.TEXT) { acc, segment ->
            acc.mergeWith(segment.format)
        }

    val isEmpty: Boolean
        get() = segments.isEmpty()
}

/**
 * Kotlin port of the shell's `AgentMessageContainer.setMessage` accumulation
 * rules (ts/packages/chat-ui/src/chatPanel.ts). Content for one request is kept
 * as an ordered list of chunks so that a trailing `temporary` chunk can be
 * discarded when the next display update arrives - which is how the shell ends
 * up showing only "Created list: grocery" instead of every progress update.
 */
internal class AgentDisplayThread {

    private class Chunk(
        var text: String,
        var format: MessageFormat,
        val kind: MessageKind
    )

    private val chunks = mutableListOf<Chunk>()
    private var lastMode: DisplayAppendMode? = null
    private var hasTemporaryTail = false

    val isEmpty: Boolean
        get() = chunks.isEmpty()

    fun setMessage(content: ParsedDisplayContent, mode: DisplayAppendMode) {
        flushTemporary()

        val text = content.text
        when (mode) {
            DisplayAppendMode.REPLACE -> {
                chunks.clear()
                if (text.isNotEmpty()) {
                    chunks += Chunk(text, content.format, content.kind)
                }
                lastMode = null
            }

            DisplayAppendMode.INLINE -> {
                if (text.isNotEmpty()) {
                    // The shell only reuses the previous content div when its
                    // kind style matches (`matchKindStyle`).
                    val last = chunks.lastOrNull()
                    if (lastMode == DisplayAppendMode.INLINE &&
                        last != null &&
                        last.kind == content.kind
                    ) {
                        last.text += text
                        last.format = last.format.mergeWith(content.format)
                    } else {
                        chunks += Chunk(text, content.format, content.kind)
                    }
                }
                lastMode = DisplayAppendMode.INLINE
            }

            DisplayAppendMode.TEMPORARY -> {
                if (text.isNotEmpty()) {
                    chunks += Chunk(text, content.format, content.kind)
                    hasTemporaryTail = true
                }
                lastMode = DisplayAppendMode.TEMPORARY
            }

            DisplayAppendMode.BLOCK, DisplayAppendMode.STEP -> {
                if (text.isNotEmpty()) {
                    chunks += Chunk(text, content.format, content.kind)
                }
                lastMode = mode
            }
        }
    }

    /**
     * Drops a trailing `temporary` chunk, matching the shell's
     * `messageDiv.lastChild?.remove()` flush. Returns true when content changed.
     */
    fun flushTemporary(): Boolean {
        if (!hasTemporaryTail) {
            return false
        }
        hasTemporaryTail = false
        lastMode = null
        return chunks.removeLastOrNull() != null
    }

    fun render(): RenderedAgentMessage {
        val segments = chunks
            .map { chunk ->
                MessageSegment(
                    text = chunk.text.trim('\n'),
                    format = chunk.format,
                    kind = chunk.kind
                )
            }
            .filter { it.text.isNotEmpty() }
        return RenderedAgentMessage(segments)
    }
}
