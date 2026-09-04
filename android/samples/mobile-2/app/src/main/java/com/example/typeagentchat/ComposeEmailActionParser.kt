package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject

internal data class ComposeEmailAction(
    val originalRequest: String,
    val to: List<String>,
    val cc: List<String>,
    val bcc: List<String>,
    val subject: String,
    val body: String
)

/** RFC 5321 caps a path at 256 octets including the angle brackets. */
private const val MAX_EMAIL_ADDRESS_CHARS = 254

/**
 * A single draft cannot usefully name more people than this, and the cap keeps
 * a runaway model from building an extra that approaches the binder budget.
 */
private const val MAX_EMAIL_RECIPIENTS = 32

/**
 * An email body is the longest field any action carries. Still three orders of
 * magnitude below the ~1 MB binder transaction limit.
 */
private const val MAX_EMAIL_BODY_CHARS = 8_000

/**
 * Deliberately loose: the point is to reject values that are obviously not
 * addresses - a name, a sentence, a phone number - not to re-derive RFC 5322,
 * which no practical regex captures. The receiving email app does the real
 * validation, and the user sees the draft before anything is sent.
 */
private val emailAddressRegex = Regex("""^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$""")

/**
 * Parses the `parameters` of the `composeEmail` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: {
 *     originalRequest: string; to?: string[]; cc?: string[]; bcc?: string[];
 *     subject?: string; body?: string;
 * }
 * ```
 *
 * The result is used with `Intent.ACTION_SENDTO` and a `mailto:` URI, which
 * opens the email app on a draft - the user still has to press send. `mailto:`
 * rather than `ACTION_SEND` on purpose: `ACTION_SEND` would offer the message
 * to every share target on the device, so a draft meant for an inbox could end
 * up in a social app instead.
 *
 * Every address is validated and a bad one fails the whole action. Dropping it
 * would be worse: the user would get a draft that quietly reaches fewer people
 * than they asked for, and the model would never learn it got the address wrong.
 */
internal fun parseComposeEmailActionPayload(data: Any?): ComposeEmailAction? {
    val payload = data as? JSONObject ?: return null

    val to = payload.parseEmailAddressList("to") ?: return null
    val cc = payload.parseEmailAddressList("cc") ?: return null
    val bcc = payload.parseEmailAddressList("bcc") ?: return null
    val subject = payload.sanitizedActionText("subject")
    val body = payload.sanitizedActionText("body", MAX_EMAIL_BODY_CHARS)

    // An entirely empty draft is not something a user ever asks for, so it is
    // treated as a failed translation rather than silently opening a blank
    // compose window the user then has to dismiss.
    if (to.isEmpty() && cc.isEmpty() && bcc.isEmpty() && subject.isEmpty() && body.isEmpty()) {
        return null
    }

    return ComposeEmailAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        to = to,
        cc = cc,
        bcc = bcc,
        subject = subject,
        body = body
    )
}

/**
 * Reads one optional address array.
 *
 * @return the validated addresses, an empty list when the field is absent, or
 *   null when the field is present but unusable - which fails the action.
 */
private fun JSONObject.parseEmailAddressList(name: String): List<String>? {
    val raw = opt(name)
    if (raw == null || raw == JSONObject.NULL) {
        return emptyList()
    }
    // A lone string where the schema says string[] is a common model slip and
    // costs nothing to accept.
    if (raw is String) {
        val address = normalizeEmailAddress(raw) ?: return null
        return listOf(address)
    }
    val array = raw as? JSONArray ?: return null
    if (array.length() > MAX_EMAIL_RECIPIENTS) {
        return null
    }

    val addresses = mutableListOf<String>()
    for (index in 0 until array.length()) {
        val entry = array.opt(index) as? String ?: return null
        val address = normalizeEmailAddress(entry) ?: return null
        if (address !in addresses) {
            addresses.add(address)
        }
    }
    return addresses
}

/**
 * Trims and validates a single address.
 *
 * Whitespace is only trimmed at the edges - an interior space means two
 * addresses were run together or the value is not an address at all, and either
 * way repairing it would guess at who the user meant.
 */
internal fun normalizeEmailAddress(raw: String): String? {
    val address = raw.trim()
    if (address.isEmpty() || address.length > MAX_EMAIL_ADDRESS_CHARS) {
        return null
    }
    return if (emailAddressRegex.matches(address)) address else null
}

/** True when [address] is usable as an email recipient. */
internal fun isSupportedEmailAddress(address: String): Boolean =
    normalizeEmailAddress(address) != null
