package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

class AlarmActionParserTest {
    @Test
    fun `parses set-alarm payload`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Wake me up at 6:30")
                .put("time", "2026-07-30T06:30:00")
        )

        requireNotNull(alarm)
        assertEquals("Wake me up at 6:30", alarm.originalRequest)
        assertEquals(6, alarm.hour)
        assertEquals(30, alarm.minute)
    }

    @Test
    fun `parses time-of-day set-alarm payload`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Set alarm")
                .put("time", "06:30")
        )

        requireNotNull(alarm)
        assertEquals(6, alarm.hour)
        assertEquals(30, alarm.minute)
    }

    @Test
    fun `rejects invalid set-alarm payload format`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Set alarm")
                .put("time", "6:30 PM")
        )

        assertNull(alarm)
    }

    @Test
    fun `rejects out of range time`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Set alarm")
                .put("time", "2026-07-30T25:75:00")
        )

        assertNull(alarm)
    }

    @Test
    fun `defaults to a one-shot alarm when no days are given`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Set alarm")
                .put("time", "06:30")
        )

        assertEquals(emptyList<Int>(), alarm?.days)
    }

    @Test
    fun `maps day names to the Calendar constants EXTRA_DAYS expects`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Wake me up on weekdays at 6:30")
                .put("time", "06:30")
                .put("days", JSONArray(listOf("monday", "wednesday", "friday")))
        )

        assertEquals(
            listOf(Calendar.MONDAY, Calendar.WEDNESDAY, Calendar.FRIDAY),
            alarm?.days
        )
    }

    @Test
    fun `normalizes case and whitespace and drops duplicates`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Set alarm")
                .put("time", "06:30")
                .put("days", JSONArray(listOf(" Monday ", "MONDAY", "sunday")))
        )

        assertEquals(listOf(Calendar.MONDAY, Calendar.SUNDAY), alarm?.days)
    }

    @Test
    fun `treats a JSON null days field as absent`() {
        val alarm = parseSetAlarmActionPayload(
            JSONObject()
                .put("originalRequest", "Set alarm")
                .put("time", "06:30")
                .put("days", JSONObject.NULL)
        )

        assertEquals(emptyList<Int>(), alarm?.days)
    }

    @Test
    fun `fails the whole alarm when a day name is unrecognized`() {
        // Setting the alarm on the subset it did understand would put it off on
        // days the user never asked for, so the action is refused instead.
        assertNull(
            parseSetAlarmActionPayload(
                JSONObject()
                    .put("originalRequest", "Set alarm")
                    .put("time", "06:30")
                    .put("days", JSONArray(listOf("monday", "caturday")))
            )
        )
    }

    @Test
    fun `rejects non-string and non-array days`() {
        assertNull(
            parseSetAlarmActionPayload(
                JSONObject()
                    .put("originalRequest", "Set alarm")
                    .put("time", "06:30")
                    .put("days", JSONArray(listOf(2)))
            )
        )
        assertNull(
            parseSetAlarmActionPayload(
                JSONObject()
                    .put("originalRequest", "Set alarm")
                    .put("time", "06:30")
                    .put("days", "monday")
            )
        )
    }

    @Test
    fun `formats repeat days Monday-first for the confirmation toast`() {
        assertEquals(
            "Mon, Fri, Sun",
            formatAlarmDays(listOf(Calendar.SUNDAY, Calendar.FRIDAY, Calendar.MONDAY))
        )
        assertEquals("", formatAlarmDays(emptyList()))
    }
}
