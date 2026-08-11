package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

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
}
