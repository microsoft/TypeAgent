package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject

internal data class ParsedDisplayContent(
    val text: String,
    val format: MessageFormat,
    val kind: MessageKind = MessageKind.NONE
)

internal fun extractAgentMessageContent(value: Any?): ParsedDisplayContent {
    val agentMessage = value as? JSONObject ?: return ParsedDisplayContent(
        text = stringifyDisplayValue(value),
        format = MessageFormat.TEXT
    )
    return extractDisplayContent(agentMessage.optNullable("message"))
}

/**
 * `IAgentMessage.kind` (AgentMessageKind). The shell routes "toast" and
 * "inline" kinds outside of the chat bubble entirely.
 */
internal fun extractAgentMessageKind(value: Any?): String? {
    val agentMessage = value as? JSONObject ?: return null
    val kind = agentMessage.optString("kind")
    return kind.ifBlank { null }
}

private fun extractDisplayContent(value: Any?): ParsedDisplayContent {
    return when (value) {
        null, JSONObject.NULL -> ParsedDisplayContent("", MessageFormat.TEXT)
        is String -> ParsedDisplayContent(value, MessageFormat.TEXT)
        is JSONArray -> ParsedDisplayContent(
            text = messageContentToText(value, declaredType = "text"),
            format = MessageFormat.TEXT
        )

        is JSONObject -> {
            val kind = MessageKind.parse(value.optString("kind"))
            when {
                value.optString("type") == "structured" -> {
                    extractBestAlternate(value.optJSONArray("alternates"), kind)
                        ?: ParsedDisplayContent(
                            text = "Structured content is not supported in this client yet.",
                            format = MessageFormat.TEXT,
                            kind = kind
                        )
                }

                value.has("content") -> {
                    val declaredType = value.optString("type").ifBlank { "text" }
                    extractSupportedTypedContent(
                        declaredType = declaredType,
                        content = value.optNullable("content"),
                        alternates = value.optJSONArray("alternates"),
                        kind = kind
                    )
                }

                value.has("message") -> extractDisplayContent(value.optNullable("message"))
                else -> ParsedDisplayContent(value.toString(), MessageFormat.TEXT)
            }
        }

        else -> ParsedDisplayContent(value.toString(), MessageFormat.TEXT)
    }
}

private fun extractSupportedTypedContent(
    declaredType: String,
    content: Any?,
    alternates: JSONArray?,
    kind: MessageKind
): ParsedDisplayContent {
    val normalizedType = declaredType.lowercase()
    return when (normalizedType) {
        "markdown" -> ParsedDisplayContent(
            text = messageContentToText(content, declaredType),
            format = MessageFormat.MARKDOWN,
            kind = kind
        )

        "text" -> ParsedDisplayContent(
            text = messageContentToText(content, declaredType),
            format = MessageFormat.TEXT,
            kind = kind
        )

        else -> extractBestAlternate(alternates, kind)
            ?: fallbackTypedContent(normalizedType, content, kind)
    }
}

private fun fallbackTypedContent(
    declaredType: String,
    content: Any?,
    kind: MessageKind
): ParsedDisplayContent {
    val fallbackText = messageContentToText(content, declaredType)
    return when (declaredType) {
        "html", "iframe" -> ParsedDisplayContent(
            text = htmlFallbackText(fallbackText),
            format = MessageFormat.TEXT,
            kind = kind
        )

        else -> ParsedDisplayContent(
            text = fallbackText,
            format = MessageFormat.TEXT,
            kind = kind
        )
    }
}

private fun extractBestAlternate(
    alternates: JSONArray?,
    kind: MessageKind
): ParsedDisplayContent? {
    if (alternates == null || alternates.length() == 0) {
        return null
    }

    val supportedOrder = listOf("markdown", "text")
    for (type in supportedOrder) {
        for (index in 0 until alternates.length()) {
            val alternate = alternates.optJSONObject(index) ?: continue
            if (!alternate.has("content")) {
                continue
            }
            val alternateType = alternate.optString("type")
            if (alternateType == type) {
                return extractSupportedTypedContent(
                    declaredType = alternateType,
                    content = alternate.optNullable("content"),
                    alternates = null,
                    kind = kind
                )
            }
        }
    }

    return null
}

private fun messageContentToText(content: Any?, declaredType: String): String {
    return when (content) {
        null, JSONObject.NULL -> ""
        is String -> content
        is JSONArray -> jsonArrayToText(content, declaredType)
        else -> content.toString()
    }
}

private fun jsonArrayToText(content: JSONArray, declaredType: String): String {
    if (content.length() == 0) {
        return ""
    }

    val first = content.optNullable(0)
    return when (first) {
        is JSONArray -> {
            val table = buildList {
                for (rowIndex in 0 until content.length()) {
                    val row = content.optJSONArray(rowIndex) ?: continue
                    add(
                        buildList {
                            for (cellIndex in 0 until row.length()) {
                                add(stringifyDisplayValue(row.optNullable(cellIndex)))
                            }
                        }
                    )
                }
            }

            if (declaredType == "markdown" || declaredType == "text") {
                tableToMarkdown(table)
            } else {
                table.joinToString("\n") { it.joinToString(" | ") }
            }
        }

        else -> buildString {
            for (index in 0 until content.length()) {
                if (isNotEmpty()) {
                    append('\n')
                }
                append(stringifyDisplayValue(content.optNullable(index)))
            }
        }
    }
}

internal fun tableToMarkdown(table: List<List<String>>): String {
    if (table.isEmpty()) {
        return ""
    }

    val rows = mutableListOf<String>()
    rows += "| ${table.first().joinToString(" | ")} |"
    rows += "| ${table.first().joinToString(" | ") { "---" }} |"
    for (index in 1 until table.size) {
        rows += "| ${table[index].joinToString(" | ")} |"
    }
    return rows.joinToString("\n")
}

internal fun stringifyDisplayValue(value: Any?): String {
    return when (value) {
        null, JSONObject.NULL -> ""
        is String -> value
        is JSONObject -> value.toString()
        is JSONArray -> value.toString()
        else -> value.toString()
    }
}

private fun stripHtmlTags(value: String): String {
    return value
        .replace(Regex("<[^>]*>"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
}

private fun htmlFallbackText(value: String): String {
    if (isReasoningTrace(value)) {
        return ""
    }
    return stripHtmlTags(value).ifBlank {
        "Rich content is not supported in this client yet."
    }
}

private fun isReasoningTrace(value: String): Boolean {
    val normalized = value.lowercase()
    return normalized.contains("reasoning-tools-call") ||
        normalized.contains("execute_actions") ||
        normalized.contains("discover-actions")
}

private fun JSONObject.optNullable(name: String): Any? {
    return if (has(name)) opt(name) else null
}

private fun JSONArray.optNullable(index: Int): Any? {
    return if (index in 0 until length()) opt(index) else null
}
