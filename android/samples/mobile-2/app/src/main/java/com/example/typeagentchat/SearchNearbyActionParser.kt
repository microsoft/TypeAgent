package com.example.typeagentchat

import org.json.JSONObject

internal data class SearchNearbyAction(
    val originalRequest: String,
    val searchTerm: String
)

/**
 * Both fields are echoed into an `Intent` (the search term via the `geo:` URI,
 * the original request only into logs and the confirmation toast), so both are
 * capped and sanitized by the shared helpers in `ActionParsing.kt`.
 */

/**
 * Parses the `parameters` of the `searchNearby` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; searchTerm: string }
 * ```
 *
 * This client re-validates because the values are shaped by an LLM and reach
 * `startActivity` unmodified.
 */
internal fun parseSearchNearbyActionPayload(data: Any?): SearchNearbyAction? {
    val payload = data as? JSONObject ?: return null
    val searchTerm = payload.sanitizedActionText("searchTerm")
    if (searchTerm.isEmpty()) {
        return null
    }
    val originalRequest = payload.sanitizedActionText("originalRequest")

    return SearchNearbyAction(
        originalRequest = originalRequest,
        searchTerm = searchTerm
    )
}

/**
 * Builds the maps search URI for [Intent.ACTION_VIEW].
 *
 * `geo:0,0?q=<term>` is the documented way to ask the maps app for a search
 * without supplying coordinates - the app substitutes the device's current
 * location, which is exactly the "nearby" semantic the agent asks for.
 *
 * The reference implementation in TypeAgent's `JavaScriptInterface.searchNearby`
 * interpolates the term straight into the string. That corrupts the query for
 * any term containing `&`, `#` or `+`, so the term is percent-encoded here
 * instead.
 */
internal fun buildGeoSearchUri(searchTerm: String): String =
    "geo:0,0?q=${percentEncode(searchTerm)}"
