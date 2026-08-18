package com.example.typeagentchat

import org.json.JSONObject

/**
 * Shared validation helpers for the `androidDevice` action parsers.
 *
 * Every value that reaches these helpers was shaped by an LLM on the server and
 * ends up inside an `Intent` that this app hands to another app, so the rules
 * here are the client-side half of the trust boundary. The server-side
 * dispatcher validates against `androidDeviceSchema.ts`; this re-validates
 * because a schema says what the model *should* emit, not what actually arrives.
 */

/**
 * Intent extras and data travel through a binder transaction with a ~1 MB
 * budget, and an oversized value makes `startActivity` throw
 * `TransactionTooLargeException` - a `RuntimeException` no caller expects. Cap
 * every free-text field so a hostile or buggy server cannot crash the app from
 * the network.
 */
internal const val MAX_ACTION_TEXT_CHARS = 256

private val controlCharRegex = Regex("""\p{Cntrl}""")
private val whitespaceRunRegex = Regex("""\s+""")

/**
 * Reads a string field, rejecting the JSON-null trap.
 *
 * Not `optString`: Android's `org.json` renders a JSON null as the literal
 * string `"null"`, which would otherwise be searched for, dialled or sent
 * verbatim.
 */
internal fun JSONObject.optActionString(name: String): String =
    (opt(name) as? String).orEmpty()

/**
 * Folds control characters (newlines and tabs included) into spaces, collapses
 * whitespace runs and caps the length.
 *
 * Control characters have no meaning in a search query, address or message and
 * would only survive as percent escapes, so removing them keeps both the URI
 * and the confirmation toast readable when the model emits multi-line text.
 */
internal fun sanitizeActionText(raw: String, maxChars: Int = MAX_ACTION_TEXT_CHARS): String =
    raw.replace(controlCharRegex, " ")
        .replace(whitespaceRunRegex, " ")
        .trim()
        .take(maxChars)
        .trim()

/** Convenience for the common "read, sanitize, cap" sequence. */
internal fun JSONObject.sanitizedActionText(
    name: String,
    maxChars: Int = MAX_ACTION_TEXT_CHARS
): String = sanitizeActionText(optActionString(name), maxChars)

/**
 * Percent-encodes a value for use inside a URI.
 *
 * Done by hand rather than with `Uri.encode` so the parsers stay unit-testable
 * on the JVM, and with `URLEncoder` out because it emits `+` for spaces, which
 * is only correct for form bodies.
 */
internal fun percentEncode(value: String): String {
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
