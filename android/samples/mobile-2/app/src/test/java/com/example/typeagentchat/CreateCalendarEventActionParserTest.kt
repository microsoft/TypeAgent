package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

class CreateCalendarEventActionParserTest {

    private val utc = TimeZone.getTimeZone("UTC")

    /** UTC+10, and never on daylight saving, so the offset is stable. */
    private val brisbane = TimeZone.getTimeZone("Australia/Brisbane")

    /** 2026-08-24T15:00:00Z */
    private val august24At3pmUtc = 1_787_583_600_000L

    /** 2026-08-24T00:00:00Z */
    private val august24MidnightUtc = 1_787_529_600_000L

    private val hour = 3_600_000L
    private val day = 86_400_000L

    private fun payload(vararg fields: Pair<String, Any?>): JSONObject {
        val json = JSONObject()
            .put("originalRequest", "Put lunch in my calendar")
            .put("title", "Lunch")
        fields.forEach { (key, value) -> json.put(key, value) }
        return json
    }

    @Test
    fun readsALocalTimeInTheDeviceTimeZone() {
        val parsed = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24T15:00"),
            timeZone = utc
        )

        assertEquals(august24At3pmUtc, parsed?.startMillis)
        assertFalse(parsed?.allDay ?: true)
    }

    @Test
    fun theSameWallClockValueMeansADifferentInstantInADifferentZone() {
        // This is the whole risk in the action: 3pm in Brisbane is not 3pm UTC,
        // and getting it wrong writes a silently wrong entry into a calendar.
        val inBrisbane = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24T15:00"),
            timeZone = brisbane
        )

        assertEquals(august24At3pmUtc - 10 * hour, inBrisbane?.startMillis)
    }

    @Test
    fun honoursAnExplicitOffsetInsteadOfRejectingIt() {
        // Models emit "Z" and "+05:30" routinely; reading them at face value in
        // the device zone would shift the event by the offset.
        assertEquals(
            august24At3pmUtc,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00Z"),
                timeZone = brisbane
            )?.startMillis
        )
        assertEquals(
            august24At3pmUtc,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T20:30+05:30"),
                timeZone = brisbane
            )?.startMillis
        )
        assertEquals(
            august24At3pmUtc,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T08:00-0700"),
                timeZone = brisbane
            )?.startMillis
        )
    }

    @Test
    fun readsAnOffsetIdenticallyUnderALocaleWithNonLatinDigits() {
        // The offset zone used to be built by formatting "GMT+%02d:%02d", which
        // uses the default locale. Under ar-EG that emits Arabic-Indic digits,
        // TimeZone.getTimeZone cannot read them, and it falls back to GMT
        // without complaining - silently moving the event by the offset.
        val original = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ar-EG-u-nu-arab"))
            assertEquals(
                august24At3pmUtc,
                parseCreateCalendarEventActionPayload(
                    payload("start" to "2026-08-24T20:30+05:30"),
                    timeZone = brisbane
                )?.startMillis
            )
        } finally {
            Locale.setDefault(original)
        }
    }

    @Test
    fun acceptsFractionalSecondsAndTruncatesThemToTheSecond() {
        // RFC 3339 permits them and models emit them. Calendar UIs are
        // minute-granular, so dropping the fraction is unobservable, whereas
        // rejecting the timestamp would fail the whole action.
        assertEquals(
            august24At3pmUtc + 30_000L,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00:30.123Z"),
                timeZone = brisbane
            )?.startMillis
        )
        assertEquals(
            august24At3pmUtc + 30_000L,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00:30,123456789Z"),
                timeZone = brisbane
            )?.startMillis
        )
    }

    @Test
    fun stillRejectsAMalformedFraction() {
        // A trailing separator with no digits is not a timestamp, and accepting
        // it would mean the regex had been loosened further than intended.
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00:30.Z"),
                timeZone = utc
            )
        )
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00.500"),
                timeZone = utc
            )
        )
    }

    @Test
    fun acceptsAnHoursOnlyOffset() {
        // ISO-8601 permits "+05" as shorthand for "+05:00"; rejecting it would
        // fail the action over a form the standard allows.
        assertEquals(
            august24At3pmUtc,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T20:00+05"),
                timeZone = brisbane
            )?.startMillis
        )
        assertEquals(
            august24At3pmUtc,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T08:00-07"),
                timeZone = brisbane
            )?.startMillis
        )
    }

    @Test
    fun rejectsAnImpossibleOffset() {
        // TimeZone.getTimeZone quietly falls back to GMT for anything it cannot
        // read, so an unchecked "+99:00" would become UTC.
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00+99:00"),
                timeZone = utc
            )
        )
    }

    @Test
    fun defaultsATimedEventToOneHour() {
        val parsed = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24T15:00"),
            timeZone = utc
        )

        assertEquals(august24At3pmUtc + hour, parsed?.endMillis)
    }

    @Test
    fun usesAnExplicitEnd() {
        val parsed = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24T15:00", "end" to "2026-08-24T17:30"),
            timeZone = utc
        )

        assertEquals(august24At3pmUtc + 2 * hour + 30 * 60_000L, parsed?.endMillis)
    }

    @Test
    fun anchorsAnAllDayEventToUtcMidnight() {
        // CalendarContract stores all-day events at UTC midnight. Using the
        // device zone would land the event on the previous day for a user in
        // UTC+10.
        val parsed = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24", "allDay" to true),
            timeZone = brisbane
        )

        assertTrue(parsed?.allDay ?: false)
        assertEquals(august24MidnightUtc, parsed?.startMillis)
        assertEquals(august24MidnightUtc + day, parsed?.endMillis)
    }

    @Test
    fun treatsAnAllDayEndAsTheLastDayTheUserNamed() {
        // "24th to the 26th" means three days, and the provider wants an
        // exclusive end, so the final day is added on.
        val parsed = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24", "end" to "2026-08-26", "allDay" to true),
            timeZone = utc
        )

        assertEquals(august24MidnightUtc + 3 * day, parsed?.endMillis)
    }

    @Test
    fun readsADateOnlyValueAsLocalMidnightWhenItIsNotAllDay() {
        val parsed = parseCreateCalendarEventActionPayload(
            payload("start" to "2026-08-24"),
            timeZone = brisbane
        )

        assertEquals(august24MidnightUtc - 10 * hour, parsed?.startMillis)
    }

    @Test
    fun rejectsAnAllDayEventThatAlsoCarriesATimeOfDay() {
        // The model contradicted itself; either reading would put something in
        // the calendar the user did not ask for.
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T09:00", "allDay" to true),
                timeZone = utc
            )
        )
    }

    @Test
    fun acceptsBooleansSentAsStrings() {
        assertTrue(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24", "allDay" to "true"),
                timeZone = utc
            )?.allDay ?: false
        )
        assertFalse(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00", "allDay" to "False"),
                timeZone = utc
            )?.allDay ?: true
        )
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24", "allDay" to "yes please"),
                timeZone = utc
            )
        )
    }

    @Test
    fun rejectsAnEndThatIsNotAfterTheStart() {
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00", "end" to "2026-08-24T15:00"),
                timeZone = utc
            )
        )
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00", "end" to "2026-08-24T09:00"),
                timeZone = utc
            )
        )
    }

    @Test
    fun rejectsAnAbsurdlyLongEvent() {
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T15:00", "end" to "2030-08-24T15:00"),
                timeZone = utc
            )
        )
    }

    @Test
    fun rejectsDatesThatDoNotExist() {
        // Non-lenient parsing: 31 February would otherwise roll into March and
        // land on a day the user never named.
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-02-31"),
                timeZone = utc
            )
        )
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-13-01"),
                timeZone = utc
            )
        )
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24T25:00"),
                timeZone = utc
            )
        )
    }

    @Test
    fun acceptsLeapDaysThatDoExist() {
        assertEquals(
            true,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2028-02-29T09:00"),
                timeZone = utc
            ) != null
        )
    }

    @Test
    fun rejectsYearsOutsideTheSupportedRange() {
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "1969-08-24T15:00"),
                timeZone = utc
            )
        )
        assertNull(
            parseCreateCalendarEventActionPayload(
                payload("start" to "9999-08-24T15:00"),
                timeZone = utc
            )
        )
    }

    @Test
    fun rejectsFormatsTheSchemaDoesNotAskFor() {
        listOf(
            "24/08/2026",
            "August 24 2026",
            "next Tuesday at 3",
            "2026-8-4T15:00",
            "15:00",
            ""
        ).forEach { value ->
            assertNull(
                "Should not accept $value",
                parseCreateCalendarEventActionPayload(
                    payload("start" to value),
                    timeZone = utc
                )
            )
        }
    }

    @Test
    fun acceptsSecondsAndASpaceSeparator() {
        assertEquals(
            august24At3pmUtc + 30_000L,
            parseCreateCalendarEventActionPayload(
                payload("start" to "2026-08-24 15:00:30"),
                timeZone = utc
            )?.startMillis
        )
    }

    @Test
    fun requiresATitle() {
        val noTitle = JSONObject()
            .put("originalRequest", "Put lunch in my calendar")
            .put("start", "2026-08-24T15:00")

        assertNull(parseCreateCalendarEventActionPayload(noTitle, timeZone = utc))
    }

    @Test
    fun keepsOptionalDetails() {
        val parsed = parseCreateCalendarEventActionPayload(
            payload(
                "start" to "2026-08-24T15:00",
                "location" to "Cafe Rio",
                "description" to "Bring the deck"
            ),
            timeZone = utc
        )

        assertEquals("Cafe Rio", parsed?.location)
        assertEquals("Bring the deck", parsed?.description)
    }

    @Test
    fun rejectsNonObjectPayloads() {
        assertNull(parseCreateCalendarEventActionPayload(null, timeZone = utc))
        assertNull(parseCreateCalendarEventActionPayload("2026-08-24T15:00", timeZone = utc))
    }
}
