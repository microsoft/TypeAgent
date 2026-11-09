package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DialPhoneNumberActionParserTest {
    private fun payload(phoneNumber: Any?): JSONObject =
        JSONObject()
            .put("originalRequest", "Call the office")
            .put("phoneNumber", phoneNumber)

    @Test
    fun parsesPlainNumber() {
        val parsed = parseDialPhoneNumberActionPayload(payload("+1 (425) 555-0100"))

        assertEquals("+1 (425) 555-0100", parsed?.phoneNumber)
        assertEquals("Call the office", parsed?.originalRequest)
    }

    @Test
    fun keepsDialableSeparatorsAndDtmfCharacters() {
        val parsed = parseDialPhoneNumberActionPayload(payload("*123#"))

        assertEquals("*123#", parsed?.phoneNumber)
    }

    @Test
    fun rejectsPauseCharactersThatCouldChangeUriParsing() {
        // ',' and ';' are dialer control characters, not part of the allowlist.
        assertNull(parseDialPhoneNumberActionPayload(payload("5550100,,123")))
        assertNull(parseDialPhoneNumberActionPayload(payload("5550100;ext=9")))
    }

    @Test
    fun rejectsNumbersWithLetters() {
        assertNull(parseDialPhoneNumberActionPayload(payload("555-CALL-NOW")))
        assertNull(parseDialPhoneNumberActionPayload(payload("tel:5550100")))
    }

    @Test
    fun rejectsSeparatorOnlyValues() {
        assertNull(parseDialPhoneNumberActionPayload(payload("()- ")))
    }

    @Test
    fun rejectsMissingBlankAndNonStringNumbers() {
        assertNull(parseDialPhoneNumberActionPayload(JSONObject()))
        assertNull(parseDialPhoneNumberActionPayload(payload("   ")))
        assertNull(parseDialPhoneNumberActionPayload(payload(JSONObject.NULL)))
        assertNull(parseDialPhoneNumberActionPayload(payload(5550100)))
        assertNull(parseDialPhoneNumberActionPayload(null))
        assertNull(parseDialPhoneNumberActionPayload("5550100"))
    }

    @Test
    fun rejectsAbsurdlyLongNumbersRatherThanTruncating() {
        // Truncating several numbers run together leaves something that still
        // passes the charset and digit checks but dials the wrong person.
        assertNull(parseDialPhoneNumberActionPayload(payload("1".repeat(64))))
        assertNull(
            parseDialPhoneNumberActionPayload(
                payload("+14255550100 +12065550199 +13605550111")
            )
        )
    }

    @Test
    fun collapsesWhitespaceRuns() {
        val parsed = parseDialPhoneNumberActionPayload(payload("+1   425\t555\n0100"))

        assertEquals("+1 425 555 0100", parsed?.phoneNumber)
    }

    @Test
    fun percentEncodesHashSoTheDialerSeesTheWholeNumber() {
        // A raw '#' would start a URI fragment and silently truncate the number.
        assertEquals("tel:%2A123%23", buildTelUri("*123#"))
        assertEquals("tel:%2B14255550100", buildTelUri("+14255550100"))
    }
}
