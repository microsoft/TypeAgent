package com.example.typeagentchat

const val WEAR_LINK_SCHEME = "typeagentchat"
const val WEAR_LINK_HOST = "main"
const val WEAR_PROMPT_PARAM = "prompt"
const val WEAR_EXECUTE_PARAM = "execute"
const val WEAR_PROMPT_MAX_LENGTH = 1_000

data class WearLinkFields(
    val scheme: String?,
    val host: String?,
    val promptQuery: String?,
    val executeQuery: String?,
    val promptExtra: String?
)

data class WearPrompt(
    val text: String,
    val requestsExecute: Boolean
)

enum class WearPromptRejection {
    NOT_A_PROMPT_LINK,
    NO_PROMPT,
    TOO_LONG
}

sealed interface WearPromptResult {
    data class Accepted(val prompt: WearPrompt) : WearPromptResult
    data class Rejected(val reason: WearPromptRejection) : WearPromptResult
}

fun parseWearPrompt(fields: WearLinkFields): WearPromptResult {
    if (
        !fields.scheme.equals(WEAR_LINK_SCHEME, ignoreCase = true) ||
        !fields.host.equals(WEAR_LINK_HOST, ignoreCase = true)
    ) {
        return WearPromptResult.Rejected(WearPromptRejection.NOT_A_PROMPT_LINK)
    }

    val prompt = fields.promptExtra
        ?.takeIf { it.isNotBlank() }
        ?: fields.promptQuery
    val text = prompt?.trim().orEmpty()
    if (text.isEmpty()) {
        return WearPromptResult.Rejected(WearPromptRejection.NO_PROMPT)
    }
    if (text.length > WEAR_PROMPT_MAX_LENGTH) {
        return WearPromptResult.Rejected(WearPromptRejection.TOO_LONG)
    }

    return WearPromptResult.Accepted(
        WearPrompt(
            text = text,
            requestsExecute = fields.executeQuery.equals("true", ignoreCase = true)
        )
    )
}
