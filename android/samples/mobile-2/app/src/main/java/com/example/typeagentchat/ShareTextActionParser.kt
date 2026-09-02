package com.example.typeagentchat

import org.json.JSONObject

internal data class ShareTextAction(
    val originalRequest: String,
    val text: String,
    val subject: String
)

/**
 * Shared text can reasonably be a paragraph or two, but it is still handed to
 * another app through a binder transaction, so it is capped like every other
 * free-text field.
 */
private const val MAX_SHARE_TEXT_CHARS = 4_000

/**
 * Parses the `parameters` of the `shareText` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; text: string; subject?: string }
 * ```
 *
 * The result is used with `Intent.ACTION_SEND` inside `Intent.createChooser`,
 * so the destination app is chosen by the user, not by the model. That matters
 * more here than for the other actions: the set of possible destinations is
 * every app on the device, so the chooser is what keeps this from being a way
 * to push model-authored text into an arbitrary app unseen.
 *
 * The text itself is required and never defaulted. There is no sensible "share
 * whatever was on screen" behaviour to fall back to, and inventing one would
 * risk sharing conversation content the user never pointed at.
 */
internal fun parseShareTextActionPayload(data: Any?): ShareTextAction? {
    val payload = data as? JSONObject ?: return null
    // Newlines survive here, unlike in the URI-bound actions: shared text is
    // carried as an extra, and a multi-line note is a normal thing to share.
    val text = payload.optActionString("text").trim().take(MAX_SHARE_TEXT_CHARS).trim()
    if (text.isEmpty()) {
        return null
    }

    return ShareTextAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        text = text,
        subject = payload.sanitizedActionText("subject")
    )
}
