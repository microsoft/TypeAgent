package com.example.typeagentchat

import org.json.JSONObject

internal data class DialPhoneNumberAction(
    val originalRequest: String,
    val phoneNumber: String
)

/**
 * `tel:` numbers are short by nature. An over-length value is *rejected* rather
 * than truncated: several numbers run together would survive a truncation with
 * the charset and digit checks intact, and dialing a plausible-looking prefix of
 * what the model produced is worse than refusing it.
 */
private const val MAX_PHONE_NUMBER_CHARS = 32

/**
 * The characters RFC 3966 allows in a dialable `tel:` number, plus the visual
 * separators people type. Anything else - letters, `;`, `?`, `/` - could change
 * how the URI parses, so a number containing them is rejected outright rather
 * than stripped: a silently altered phone number is worse than a refused one.
 */
private val dialableCharRegex = Regex("""^[0-9+\-().#*\s]+$""")

/**
 * Parses the `parameters` of the `dialPhoneNumber` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; phoneNumber: string }
 * ```
 *
 * The result is used with `Intent.ACTION_DIAL`, which only pre-fills the dialer
 * - the user still has to press call. That is why no `CALL_PHONE` permission is
 * needed and why a hallucinated number cannot dial itself. `ACTION_CALL` is
 * deliberately not used.
 */
internal fun parseDialPhoneNumberActionPayload(data: Any?): DialPhoneNumberAction? {
    val payload = data as? JSONObject ?: return null
    val phoneNumber = payload.sanitizedActionText("phoneNumber")
    if (phoneNumber.isEmpty() ||
        phoneNumber.length > MAX_PHONE_NUMBER_CHARS ||
        !dialableCharRegex.matches(phoneNumber)
    ) {
        return null
    }
    // A string of only separators - "( ) -" - passes the charset check but is
    // not a number.
    if (phoneNumber.none { it.isDigit() }) {
        return null
    }

    return DialPhoneNumberAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        phoneNumber = phoneNumber
    )
}

/**
 * Builds the `tel:` URI for [android.content.Intent.ACTION_DIAL].
 *
 * `#` is significant here: left raw it starts a URI fragment, so a number
 * ending in `#` would reach the dialer truncated. Percent-encoding the whole
 * number sidesteps that and every other separator.
 */
internal fun buildTelUri(phoneNumber: String): String = "tel:${percentEncode(phoneNumber)}"
