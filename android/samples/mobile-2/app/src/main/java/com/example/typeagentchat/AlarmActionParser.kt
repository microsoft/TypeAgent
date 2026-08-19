package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

internal data class SetAlarmAction(
    val originalRequest: String,
    val hour: Int,
    val minute: Int,
    /**
     * Days the alarm repeats on, as `java.util.Calendar` day-of-week constants
     * ready for `AlarmClock.EXTRA_DAYS`. Empty means a one-off alarm.
     */
    val days: List<Int> = emptyList()
)

private val alarmTimeRegex =
    Regex("""^(?:\d{4}-\d{2}-\d{2}T)?(\d{2}):(\d{2})(?::\d{2})?$""")

/**
 * The closed set of day names the schema offers, mapped to the `Calendar`
 * constants `AlarmClock.EXTRA_DAYS` is documented to take.
 *
 * A map rather than a parse of whatever the model emits: an unrecognised day
 * name means the alarm would repeat on the wrong days or on none, and silently
 * guessing is worse than refusing.
 */
private val dayNamesToCalendarDays = mapOf(
    "monday" to Calendar.MONDAY,
    "tuesday" to Calendar.TUESDAY,
    "wednesday" to Calendar.WEDNESDAY,
    "thursday" to Calendar.THURSDAY,
    "friday" to Calendar.FRIDAY,
    "saturday" to Calendar.SATURDAY,
    "sunday" to Calendar.SUNDAY
)

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

    val days = parseAlarmDays(payload.opt("days")) ?: return null

    return SetAlarmAction(
        originalRequest = originalRequest,
        hour = hour,
        minute = minute,
        days = days
    )
}
/**
 * Reads the optional `days` array.
 *
 * @return the `Calendar` constants in schema order with duplicates removed, an
 * empty list when the field is absent, or null when any entry is not a
 * recognised day name - which fails the whole action rather than quietly
 * setting an alarm for a subset of the days the user asked for.
 */
private fun parseAlarmDays(raw: Any?): List<Int>? {
    if (raw == null || raw == JSONObject.NULL) {
        return emptyList()
    }
    val array = raw as? JSONArray ?: return null
    val days = LinkedHashSet<Int>()
    for (index in 0 until array.length()) {
        val name = (array.opt(index) as? String)?.trim()?.lowercase() ?: return null
        days.add(dayNamesToCalendarDays[name] ?: return null)
    }
    return days.toList()
}

/**
 * Human-readable repeat days for the confirmation toast, e.g. "Mon, Wed, Fri".
 *
 * Ordered Monday-first regardless of the order the model listed them, so the
 * toast reads the way a week does rather than echoing the request's phrasing.
 */
internal fun formatAlarmDays(days: List<Int>): String {
    val labels = mapOf(
        Calendar.MONDAY to "Mon",
        Calendar.TUESDAY to "Tue",
        Calendar.WEDNESDAY to "Wed",
        Calendar.THURSDAY to "Thu",
        Calendar.FRIDAY to "Fri",
        Calendar.SATURDAY to "Sat",
        Calendar.SUNDAY to "Sun"
    )
    return labels.keys
        .filter { it in days }
        .joinToString(", ") { labels.getValue(it) }
}
