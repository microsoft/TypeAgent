package com.example.typeagentchat

import org.json.JSONObject
import kotlin.math.floor

internal data class SetTimerAction(
    val originalRequest: String,
    val durationInSeconds: Int
)

/**
 * `AlarmClock.EXTRA_LENGTH` is documented as accepting 1..86400 seconds
 * (24 hours). Anything outside that is rejected rather than clamped so a
 * mistranslated duration surfaces in the log instead of silently setting a
 * timer the user did not ask for.
 */
private const val MAX_TIMER_SECONDS = 86_400L

/**
 * `originalRequest` is echoed into `AlarmClock.EXTRA_MESSAGE`. Intent extras
 * travel through a binder transaction with a ~1 MB budget, and an oversized
 * extra makes `startActivity` throw `TransactionTooLargeException` - a
 * `RuntimeException` no caller expects. Cap the label so a hostile or buggy
 * server cannot crash the app from the network.
 */
private const val MAX_ORIGINAL_REQUEST_CHARS = 256

/**
 * Parses the `parameters` of the `setTimer` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; durationInSeconds: number }
 * ```
 *
 * The server-side dispatcher already validates against the schema, but this
 * client re-validates because the value is shaped by an LLM and reaches
 * `startActivity` unmodified.
 */
internal fun parseSetTimerActionPayload(data: Any?): SetTimerAction? {
    val payload = data as? JSONObject ?: return null
    // Not `optString`: Android's org.json renders a JSON null as the literal
    // string "null", which would end up as the timer label.
    val originalRequest = (payload.opt("originalRequest") as? String)
        .orEmpty()
        .trim()
        .take(MAX_ORIGINAL_REQUEST_CHARS)
    val duration = readDurationSeconds(payload) ?: return null
    if (duration <= 0L || duration > MAX_TIMER_SECONDS) {
        return null
    }

    return SetTimerAction(
        originalRequest = originalRequest,
        durationInSeconds = duration.toInt()
    )
}

private fun readDurationSeconds(payload: JSONObject): Long? {
    val raw = payload.opt("durationInSeconds")
    val value = when (raw) {
        is Number -> raw.toDouble()
        is String -> raw.trim().toDoubleOrNull()
        else -> null
    } ?: return null

    if (value.isNaN() || value.isInfinite()) {
        return null
    }
    return floor(value).toLong()
}

/** Human-readable duration for the confirmation toast, e.g. "1 h 5 min 30 s". */
internal fun formatTimerDuration(totalSeconds: Int): String {
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    val parts = buildList {
        if (hours > 0) add("$hours h")
        if (minutes > 0) add("$minutes min")
        if (seconds > 0 || isEmpty()) add("$seconds s")
    }
    return parts.joinToString(" ")
}
