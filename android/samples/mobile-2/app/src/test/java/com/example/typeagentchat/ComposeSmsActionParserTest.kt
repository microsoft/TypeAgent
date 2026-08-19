package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposeSmsActionParserTest {
    private fun payload(message: Any?, phoneNumber: Any? = null): JSONObject {
        val payload = JSONObject()
            .put("originalRequest", "Text Sam that I am running late")
            .put("message", message)
        if (phoneNumber != null) {
            payload.put("phoneNumber", phoneNumber)
        }
        return payload
    }

    @Test
    fun parsesMessageAndRecipient() {
        val parsed = parseComposeSmsActionPayload(payload("Running late", "+14255550100"))

        assertEquals("Running late", parsed?.message)
        assertEquals("+14255550100", parsed?.phoneNumber)
    }

    @Test
    fun recipientIsOptional() {
        val parsed = parseComposeSmsActionPayload(payload("Running late"))

        assertEquals("Running late", parsed?.message)
        assertNull(parsed?.phoneNumber)
        // A bare "smsto:" is the documented way to open a draft with an empty
        // recipient field.
        assertEquals("smsto:", buildSmsToUri(parsed?.phoneNumber))
    }

    @Test
    fun treatsBlankAndJsonNullRecipientsAsAbsentRatherThanInvalid() {
        assertNull(parseComposeSmsActionPayload(payload("Running late", "   "))?.phoneNumber)
        assertNull(
            parseComposeSmsActionPayload(payload("Running late", JSONObject.NULL))?.phoneNumber
        )
    }

    @Test
    fun rejectsUnusableRecipientInsteadOfDroppingIt() {
        // Silently opening a draft addressed to nobody would look like success.
        assertNull(parseComposeSmsActionPayload(payload("Running late", "Sam")))
        assertNull(parseComposeSmsActionPayload(payload("Running late", "()-")))
        assertNull(parseComposeSmsActionPayload(payload("Running late", "1".repeat(64))))
    }

    @Test
    fun allowsLongMultipartBodies() {
        val body = "c".repeat(1_000)
        val parsed = parseComposeSmsActionPayload(payload(body))

        assertEquals(1_000, parsed?.message?.length)
    }

    @Test
    fun capsAbsurdlyLongBodies() {
        val parsed = parseComposeSmsActionPayload(payload("c".repeat(5_000)))

        assertEquals(1_600, parsed?.message?.length)
    }

    @Test
    fun rejectsMissingBlankAndNonStringMessages() {
        assertNull(parseComposeSmsActionPayload(JSONObject()))
        assertNull(parseComposeSmsActionPayload(payload("   ")))
        assertNull(parseComposeSmsActionPayload(payload(JSONObject.NULL)))
        assertNull(parseComposeSmsActionPayload(payload(123)))
        assertNull(parseComposeSmsActionPayload(null))
        assertNull(parseComposeSmsActionPayload("hello"))
    }

    @Test
    fun percentEncodesTheRecipient() {
        assertTrue(buildSmsToUri("+14255550100").startsWith("smsto:"))
        assertEquals("smsto:%2B14255550100", buildSmsToUri("+14255550100"))
    }
}
