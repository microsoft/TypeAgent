package com.example.typeagentchat

import org.json.JSONObject

internal data class SetAlarmAction(
    val originalRequest: String,
    val hour: Int,
    val minute: Int
)

private val alarmTimeRegex =
    Regex("""^(?:\d{4}-\d{2}-\d{2}T)?(\d{2}):(\d{2})(?::\d{2})?$""")

internal fun parseSetAlarmActionPayload(data: Any?): SetAlarmAction? {
    val payload = data as? JSONObject ?: return null
    val originalRequest = payload.optString("originalRequest").trim()
    val time = payload.optString("time").trim()
    if (time.isBlank()) {
        return null
    }

    val match = alarmTimeRegex.matchEntire(time) ?: return null
    val hour = match.groupValues[1].toIntOrNull() ?: return null
    val minute = match.groupValues[2].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) {
        return null
    }

    return SetAlarmAction(
        originalRequest = originalRequest,
        hour = hour,
        minute = minute
    )
}
