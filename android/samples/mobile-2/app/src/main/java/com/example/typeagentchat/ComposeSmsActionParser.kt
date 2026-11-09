package com.example.typeagentchat

import org.json.JSONObject

internal data class ComposeSmsAction(
    val originalRequest: String,
    val message: String,
    val phoneNumber: String?
)

private const val MAX_PHONE_NUMBER_CHARS = 32

/**
 * A text message body is longer than the other free-text fields - a multi-part
 * SMS runs well past 256 characters - but still far below the binder
 * transaction budget.
 */
private const val MAX_SMS_BODY_CHARS = 1_600

private val dialableCharRegex = Regex("""^[0-9+\-().#*\s]+$""")

/**
 * Parses the `parameters` of the `composeSms` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; message: string; phoneNumber?: string }
 * ```
 *
 * The result is used with `Intent.ACTION_SENDTO`, which opens the messaging app
 * on a pre-filled draft - the user still has to press send. That is why no
 * `SEND_SMS` permission is needed and why a hallucinated body or recipient
 * cannot go out unseen. Upstream's `sendSMS` is deliberately not implemented.
 *
 * The recipient is optional: with none, the messaging app opens on a draft with
 * an empty recipient field, which is the right behaviour when the user said
 * what to send but not to whom. An unusable recipient is a different matter -
 * it is rejected rather than dropped, so the model is told the number was bad
 * instead of the user silently getting a draft addressed to nobody.
 */
internal fun parseComposeSmsActionPayload(data: Any?): ComposeSmsAction? {
    val payload = data as? JSONObject ?: return null
    val message = payload.sanitizedActionText("message", MAX_SMS_BODY_CHARS)
    if (message.isEmpty()) {
        return null
    }

    val rawPhoneNumber = payload.sanitizedActionText("phoneNumber")
    val phoneNumber = if (rawPhoneNumber.isEmpty()) {
        null
    } else {
        // Rejected rather than truncated, for the same reason as dialPhoneNumber:
        // a prefix of several numbers run together still looks like a number.
        if (rawPhoneNumber.length > MAX_PHONE_NUMBER_CHARS ||
            !dialableCharRegex.matches(rawPhoneNumber) ||
            rawPhoneNumber.none { it.isDigit() }
        ) {
            return null
        }
        rawPhoneNumber
    }

    return ComposeSmsAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        message = message,
        phoneNumber = phoneNumber
    )
}

/**
 * Builds the `smsto:` URI for [android.content.Intent.ACTION_SENDTO].
 *
 * A bare `smsto:` with no number is the documented way to open a draft with an
 * empty recipient field.
 */
internal fun buildSmsToUri(phoneNumber: String?): String =
    if (phoneNumber.isNullOrEmpty()) "smsto:" else "smsto:${percentEncode(phoneNumber)}"
