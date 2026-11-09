package com.example.typeagentchat

import org.json.JSONObject

internal data class WebSearchAction(
    val originalRequest: String,
    val query: String
)

/**
 * Parses the `parameters` of the `webSearch` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; query: string }
 * ```
 *
 * The query travels as the `SearchManager.QUERY` extra on
 * `Intent.ACTION_WEB_SEARCH`, so it is never spliced into a URL and needs no
 * encoding - only the shared sanitisation and length cap.
 */
internal fun parseWebSearchActionPayload(data: Any?): WebSearchAction? {
    val payload = data as? JSONObject ?: return null
    val query = payload.sanitizedActionText("query")
    if (query.isEmpty()) {
        return null
    }

    return WebSearchAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        query = query
    )
}
