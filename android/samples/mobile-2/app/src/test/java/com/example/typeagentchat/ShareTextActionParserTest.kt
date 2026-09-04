package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShareTextActionParserTest {
    private fun payload(text: Any?, subject: Any? = null): JSONObject =
        JSONObject()
            .put("originalRequest", "Share this")
            .put("text", text)
            .apply { if (subject != null) put("subject", subject) }

    @Test
    fun parsesTextAndSubject() {
        val parsed = parseShareTextActionPayload(payload("Meet at 6", "Plans"))

        assertEquals("Meet at 6", parsed?.text)
        assertEquals("Plans", parsed?.subject)
    }

    @Test
    fun keepsLineBreaksInsideSharedText() {
        // Unlike the URI-bound actions, shared text rides as an extra, so a
        // multi-line note survives intact.
        val parsed = parseShareTextActionPayload(payload("line one\nline two"))

        assertEquals("line one\nline two", parsed?.text)
    }

    @Test
    fun trimsSurroundingWhitespace() {
        assertEquals("hello", parseShareTextActionPayload(payload("  hello \n"))?.text)
    }

    @Test
    fun defaultsTheSubjectToEmpty() {
        assertEquals("", parseShareTextActionPayload(payload("hello"))?.subject)
    }

    @Test
    fun requiresText() {
        // There is no safe default here: falling back to "whatever was on
        // screen" could share conversation content the user never pointed at.
        assertNull(parseShareTextActionPayload(payload("")))
        assertNull(parseShareTextActionPayload(payload("   ")))
        assertNull(parseShareTextActionPayload(payload(JSONObject.NULL)))
        assertNull(parseShareTextActionPayload(JSONObject()))
    }

    @Test
    fun capsOverlongText() {
        val parsed = parseShareTextActionPayload(payload("x".repeat(9_000)))

        assertEquals(4_000, parsed?.text?.length)
    }

    @Test
    fun rejectsNonObjectPayloads() {
        assertNull(parseShareTextActionPayload(null))
        assertNull(parseShareTextActionPayload("hello"))
    }
}
