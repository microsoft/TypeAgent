package com.example.typeagentchat

import org.json.JSONObject

internal data class SearchNearbyAction(
    val originalRequest: String,
    val searchTerm: String
)

/**
 * Keeps intent data well under the ~1 MB binder budget; an oversized value
 * makes `startActivity` throw `TransactionTooLargeException`, so a hostile or
 * buggy server cannot crash the app from the network.
 */
private const val MAX_ORIGINAL_REQUEST_CHARS = 256
private const val MAX_SEARCH_TERM_CHARS = 256

private val controlCharRegex = Regex("""\p{Cntrl}""")
private val whitespaceRunRegex = Regex("""\s+""")

/**
 * Parses `takeAction("search-nearby", ...)` from the androidMobile agent:
 * `{ originalRequest: string; searchTerm: string }`. Re-validated here because
 * `takeAction` is fire-and-forget and carries no schema guarantee over the wire.
 */
internal fun parseSearchNearbyActionPayload(data: Any?): SearchNearbyAction? {
    val payload = data as? JSONObject ?: return null
    // `opt(...) as? String`, not `optString`: org.json renders a JSON null as
    // the literal string "null", which would be searched for verbatim.
    val searchTerm = sanitize((payload.opt("searchTerm") as? String).orEmpty())
        .take(MAX_SEARCH_TERM_CHARS)
        .trim()
    if (searchTerm.isEmpty()) {
        return null
    }
    val originalRequest = sanitize((payload.opt("originalRequest") as? String).orEmpty())
        .take(MAX_ORIGINAL_REQUEST_CHARS)
        .trim()

    return SearchNearbyAction(
        originalRequest = originalRequest,
        searchTerm = searchTerm
    )
}

/**
 * Folds control characters and whitespace runs into single spaces so a
 * multi-line term does not become a URI full of `%0A`.
 */
private fun sanitize(raw: String): String =
    raw.replace(controlCharRegex, " ")
        .replace(whitespaceRunRegex, " ")
        .trim()

/**
 * `geo:0,0?q=<term>` searches without coordinates - `0,0` makes the maps app
 * substitute the device's current location, i.e. the "nearby" semantic.
 *
 * The term is percent-encoded rather than interpolated (as TypeAgent's
 * `JavaScriptInterface.searchNearby` does), which would corrupt any term
 * containing `&`, `#` or `?`. Hand-rolled because `Uri.encode` is unavailable
 * in JVM unit tests and `URLEncoder` emits `+` for spaces.
 */
internal fun buildGeoSearchUri(searchTerm: String): String =
    "geo:0,0?q=${percentEncode(searchTerm)}"

private fun percentEncode(value: String): String {
    val builder = StringBuilder()
    for (byte in value.toByteArray(Charsets.UTF_8)) {
        val char = (byte.toInt() and 0xFF).toChar()
        val unreserved = char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' ||
            char == '-' || char == '_' || char == '.' || char == '~'
        if (unreserved) {
            builder.append(char)
        } else {
            builder.append('%').append("%02X".format(byte))
        }
    }
    return builder.toString()
}
