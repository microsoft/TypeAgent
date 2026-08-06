package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TimerActionParserTest {

    private fun payload(duration: Any, request: String = "Set a timer for 30 seconds") =
        JSONObject()
            .put("originalRequest", request)
            .put("durationInSeconds", duration)

    @Test
    fun `parses set-timer payload`() {
        val timer = parseSetTimerActionPayload(payload(30))

        requireNotNull(timer)
        assertEquals("Set a timer for 30 seconds", timer.originalRequest)
        assertEquals(30, timer.durationInSeconds)
    }

    @Test
    fun `floors fractional durations`() {
        val timer = parseSetTimerActionPayload(payload(30.9))

        requireNotNull(timer)
        assertEquals(30, timer.durationInSeconds)
    }

    @Test
    fun `accepts a numeric string duration`() {
        val timer = parseSetTimerActionPayload(payload("300"))

        requireNotNull(timer)
        assertEquals(300, timer.durationInSeconds)
    }

    @Test
    fun `rejects zero and negative durations`() {
        assertNull(parseSetTimerActionPayload(payload(0)))
        assertNull(parseSetTimerActionPayload(payload(-5)))
        // Floors to 0 rather than rounding up to 1.
        assertNull(parseSetTimerActionPayload(payload(0.4)))
    }

    @Test
    fun `rejects durations beyond the AlarmClock 24 hour limit`() {
        assertEquals(86_400, parseSetTimerActionPayload(payload(86_400))?.durationInSeconds)
        assertNull(parseSetTimerActionPayload(payload(86_401)))
    }

    @Test
    fun `rejects missing or non-numeric durations`() {
        assertNull(
            parseSetTimerActionPayload(JSONObject().put("originalRequest", "Set a timer"))
        )
        assertNull(parseSetTimerActionPayload(payload("half an hour")))
        // org.json forbids NaN/Infinity as JSON numbers, but String.toDoubleOrNull
        // happily parses these spellings, so the guard is reachable via a string.
        assertNull(parseSetTimerActionPayload(payload("NaN")))
        assertNull(parseSetTimerActionPayload(payload("Infinity")))
    }

    @Test
    fun `rejects a non-object payload`() {
        assertNull(parseSetTimerActionPayload(null))
        assertNull(parseSetTimerActionPayload("30"))
    }

    @Test
    fun `tolerates a missing originalRequest`() {
        val timer = parseSetTimerActionPayload(JSONObject().put("durationInSeconds", 60))

        requireNotNull(timer)
        assertEquals("", timer.originalRequest)
        assertEquals(60, timer.durationInSeconds)
    }

    @Test
    fun `treats a JSON null originalRequest as absent`() {
        val timer = parseSetTimerActionPayload(
            JSONObject()
                .put("originalRequest", JSONObject.NULL)
                .put("durationInSeconds", 45)
        )

        requireNotNull(timer)
        assertEquals("", timer.originalRequest)
    }

    @Test
    fun `rejects a JSON null duration`() {
        assertNull(
            parseSetTimerActionPayload(
                JSONObject()
                    .put("originalRequest", "Set a timer")
                    .put("durationInSeconds", JSONObject.NULL)
            )
        )
    }

    @Test
    fun `accepts a long duration value`() {
        val timer = parseSetTimerActionPayload(payload(120L))

        requireNotNull(timer)
        assertEquals(120, timer.durationInSeconds)
    }

    @Test
    fun `caps an oversized originalRequest`() {
        val timer = parseSetTimerActionPayload(payload(60, "a".repeat(10_000)))

        requireNotNull(timer)
        assertEquals(256, timer.originalRequest.length)
    }

    @Test
    fun `blank originalRequest normalizes to empty`() {
        val timer = parseSetTimerActionPayload(payload(60, "   "))

        requireNotNull(timer)
        assertEquals("", timer.originalRequest)
    }

    @Test
    fun `formats durations for the confirmation toast`() {
        assertEquals("30 s", formatTimerDuration(30))
        assertEquals("5 min", formatTimerDuration(300))
        assertEquals("1 h 5 min 30 s", formatTimerDuration(3930))
        assertEquals("24 h", formatTimerDuration(86_400))
        assertEquals("0 s", formatTimerDuration(0))
    }
}
