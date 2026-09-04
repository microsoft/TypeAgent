package com.example.typeagentchat

import org.json.JSONObject
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.SimpleTimeZone
import java.util.TimeZone

internal data class CreateCalendarEventAction(
    val originalRequest: String,
    val title: String,
    /** Epoch milliseconds for `CalendarContract.EXTRA_EVENT_BEGIN_TIME`. */
    val startMillis: Long,
    /** Epoch milliseconds for `CalendarContract.EXTRA_EVENT_END_TIME`, always after [startMillis]. */
    val endMillis: Long,
    val allDay: Boolean,
    val location: String,
    val description: String
)

private const val MAX_EVENT_TITLE_CHARS = 256
private const val MAX_EVENT_LOCATION_CHARS = 256
private const val MAX_EVENT_DESCRIPTION_CHARS = 4_000

private const val MILLIS_PER_MINUTE = 60_000L
private const val MILLIS_PER_HOUR = 60L * MILLIS_PER_MINUTE
private const val MILLIS_PER_DAY = 24L * MILLIS_PER_HOUR

/** Default length of an event whose end the user did not give. */
private const val DEFAULT_EVENT_MILLIS = MILLIS_PER_HOUR

/**
 * Anything longer is far likelier to be a mis-parsed year than a real event,
 * and a multi-decade block dropped into someone's calendar is annoying to undo.
 */
private const val MAX_EVENT_SPAN_MILLIS = 366L * MILLIS_PER_DAY

/** Guards against a mistyped or hallucinated year landing an event in year 9999. */
private val supportedYears = 1970..2200

/**
 * `YYYY-MM-DD` on its own, or with a `T`-separated local time and an optional
 * `Z`/`+hh:mm` offset.
 *
 * A space is accepted in place of `T` and lower case `t`/`z` are allowed
 * because models produce both; neither changes the meaning.
 *
 * Fractional seconds are accepted (RFC 3339 permits them and models emit them)
 * but discarded: calendar UIs are minute-granular, so sub-second precision is
 * not something the user could observe, and rejecting an otherwise valid
 * timestamp over it would fail the action for no benefit.
 */
private val isoDateTimeRegex = Regex(
    """^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?\s*([Zz]|[+-]\d{2}(?::?\d{2})?)?)?$"""
)

/**
 * A parsed ISO-8601 value, before it is turned into an instant.
 *
 * The time zone is kept separate from the fields because the same wall-clock
 * value means different instants depending on whose clock it is: an all-day
 * event is anchored to UTC midnight by `CalendarContract`, a floating local time
 * belongs to the device's zone, and an explicit offset overrides both.
 */
private data class IsoDateTimeParts(
    val year: Int,
    val month: Int,
    val day: Int,
    val hour: Int,
    val minute: Int,
    val second: Int,
    val hasTimeOfDay: Boolean,
    val explicitZone: TimeZone?
)

/**
 * Parses the `parameters` of the `createCalendarEvent` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: {
 *     originalRequest: string; title: string; start: string; end?: string;
 *     allDay?: boolean; location?: string; description?: string;
 * }
 * ```
 *
 * The result is used with `Intent.ACTION_INSERT` on the calendar provider,
 * which opens the calendar app's new-event editor pre-filled - the user still
 * has to save. No calendar permission is involved, because the calendar app
 * does the write.
 *
 * Date handling is the whole risk in this action. `CalendarContract` wants epoch
 * milliseconds, and the difference between "3pm" in the device's zone and 3pm
 * UTC is a silently wrong entry in someone's calendar, so:
 * - a value with no offset is read in [timeZone], the device's own zone;
 * - a value carrying `Z` or `+hh:mm` is honoured at that offset rather than
 *   being rejected, since models emit those routinely;
 * - an all-day event is anchored to UTC midnight, which is what the provider
 *   documents and what every calendar app expects.
 *
 * @param timeZone the zone a value without an explicit offset is read in.
 *   Injectable so the tests do not depend on the machine's zone.
 */
internal fun parseCreateCalendarEventActionPayload(
    data: Any?,
    timeZone: TimeZone = TimeZone.getDefault()
): CreateCalendarEventAction? {
    val payload = data as? JSONObject ?: return null

    val title = payload.sanitizedActionText("title", MAX_EVENT_TITLE_CHARS)
    if (title.isEmpty()) {
        return null
    }

    val allDay = when (val raw = payload.opt("allDay")) {
        null, JSONObject.NULL -> false
        is Boolean -> raw
        // "true"/"false" as a string is a common model slip and is unambiguous.
        is String -> raw.trim().lowercase().toBooleanStrictOrNull() ?: return null
        else -> return null
    }

    val start = parseIsoDateTime(payload.sanitizedActionText("start")) ?: return null
    // The schema asks for a date only when allDay is set. A time of day here
    // means the model contradicted itself, and either reading of it - honour
    // the time, or drop it - would put something in the calendar the user did
    // not ask for, so the action fails and says so instead.
    if (allDay && start.hasTimeOfDay) {
        return null
    }

    val rawEnd = payload.sanitizedActionText("end")
    val end = if (rawEnd.isEmpty()) null else parseIsoDateTime(rawEnd) ?: return null
    if (end != null && allDay && end.hasTimeOfDay) {
        return null
    }

    val startMillis = start.toEpochMillis(timeZone, allDay) ?: return null
    val endMillis = when {
        end != null -> {
            val parsed = end.toEpochMillis(timeZone, allDay) ?: return null
            // For an all-day event the user names the last day they mean, while
            // the provider wants an exclusive end, so the final day is added on.
            if (allDay) parsed + MILLIS_PER_DAY else parsed
        }

        allDay -> startMillis + MILLIS_PER_DAY
        else -> startMillis + DEFAULT_EVENT_MILLIS
    }

    if (endMillis <= startMillis || endMillis - startMillis > MAX_EVENT_SPAN_MILLIS) {
        return null
    }

    return CreateCalendarEventAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        title = title,
        startMillis = startMillis,
        endMillis = endMillis,
        allDay = allDay,
        location = payload.sanitizedActionText("location", MAX_EVENT_LOCATION_CHARS),
        description = payload.sanitizedActionText("description", MAX_EVENT_DESCRIPTION_CHARS)
    )
}

/** Parses an ISO-8601 local date, or date and time, into its fields. */
private fun parseIsoDateTime(value: String): IsoDateTimeParts? {
    val match = isoDateTimeRegex.matchEntire(value.trim()) ?: return null
    val (year, month, day, hour, minute, second, offset) = match.destructured

    val explicitZone = if (offset.isEmpty()) null else parseOffsetZone(offset) ?: return null

    return IsoDateTimeParts(
        year = year.toInt(),
        month = month.toInt(),
        day = day.toInt(),
        hour = if (hour.isEmpty()) 0 else hour.toInt(),
        minute = if (minute.isEmpty()) 0 else minute.toInt(),
        second = if (second.isEmpty()) 0 else second.toInt(),
        hasTimeOfDay = hour.isNotEmpty(),
        explicitZone = explicitZone
    )
}

/**
 * Turns `Z` or `+hh:mm` into a fixed-offset zone.
 *
 * The zone is built from a raw offset in milliseconds rather than by handing
 * `TimeZone.getTimeZone` a `GMT+hh:mm` string. Two reasons: that method falls
 * back to GMT for anything it cannot read rather than failing, and formatting
 * the string with `"%02d"` uses the default locale, which in locales with
 * non-Latin digits emits characters `getTimeZone` cannot read - so a valid
 * `+05:30` would silently become UTC and move the event five and a half hours.
 * A raw integer offset cannot be misread.
 *
 * The offset is still range-checked, since `+99:00` is not a real zone.
 */
private fun parseOffsetZone(offset: String): TimeZone? {
    if (offset.equals("Z", ignoreCase = true)) {
        return TimeZone.getTimeZone("UTC")
    }
    val sign = if (offset[0] == '-') -1 else 1
    val digits = offset.substring(1).replace(":", "")
    // ISO-8601 allows the minutes to be omitted, so "+05" means "+05:00".
    val minutePart = when (digits.length) {
        2 -> "00"
        4 -> digits.substring(2, 4)
        else -> return null
    }
    val hours = digits.substring(0, 2).toInt()
    val minutes = minutePart.toInt()
    if (hours > 18 || minutes > 59) {
        return null
    }
    val offsetMillis = (sign * (hours * MILLIS_PER_HOUR + minutes * MILLIS_PER_MINUTE)).toInt()
    if (offsetMillis == 0) {
        return TimeZone.getTimeZone("UTC")
    }
    // SimpleTimeZone with no DST rule is exactly an ISO-8601 fixed offset.
    return SimpleTimeZone(offsetMillis, "UTC$offset")
}

/**
 * Resolves the fields to an instant, or null when they do not describe a real
 * date - 31 February and 25 o'clock included.
 *
 * @param allDay anchors the value to UTC midnight, which is how
 *   `CalendarContract` stores all-day events; without it a user in UTC+10 would
 *   see the event land on the previous day.
 */
private fun IsoDateTimeParts.toEpochMillis(timeZone: TimeZone, allDay: Boolean): Long? {
    if (year !in supportedYears) {
        return null
    }
    val zone = when {
        allDay -> TimeZone.getTimeZone("UTC")
        else -> explicitZone ?: timeZone
    }
    val calendar = GregorianCalendar(zone).apply {
        // Non-lenient so 2026-02-31 is rejected instead of rolling into March,
        // which would put the event on a day the user never named.
        isLenient = false
        clear()
        set(Calendar.YEAR, year)
        set(Calendar.MONTH, month - 1)
        set(Calendar.DAY_OF_MONTH, day)
        set(Calendar.HOUR_OF_DAY, hour)
        set(Calendar.MINUTE, minute)
        set(Calendar.SECOND, second)
    }
    return try {
        calendar.timeInMillis
    } catch (_: IllegalArgumentException) {
        null
    }
}
