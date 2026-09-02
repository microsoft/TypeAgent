package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposeEmailActionParserTest {
    private fun payload(vararg fields: Pair<String, Any?>): JSONObject {
        val json = JSONObject().put("originalRequest", "Email the team")
        fields.forEach { (key, value) -> json.put(key, value) }
        return json
    }

    @Test
    fun parsesAFullDraft() {
        val parsed = parseComposeEmailActionPayload(
            payload(
                "to" to JSONArray().put("ada@example.com"),
                "cc" to JSONArray().put("grace@example.com"),
                "bcc" to JSONArray().put("alan@example.com"),
                "subject" to "Status",
                "body" to "All good."
            )
        )

        assertEquals(listOf("ada@example.com"), parsed?.to)
        assertEquals(listOf("grace@example.com"), parsed?.cc)
        assertEquals(listOf("alan@example.com"), parsed?.bcc)
        assertEquals("Status", parsed?.subject)
        assertEquals("All good.", parsed?.body)
    }

    @Test
    fun acceptsASingleAddressWhereTheSchemaAsksForAnArray() {
        val parsed = parseComposeEmailActionPayload(payload("to" to "ada@example.com"))

        assertEquals(listOf("ada@example.com"), parsed?.to)
    }

    @Test
    fun allowsADraftWithNoRecipientSoTheUserCanFillItIn() {
        val parsed = parseComposeEmailActionPayload(
            payload("subject" to "Notes", "body" to "Draft this for me")
        )

        assertEquals(emptyList<String>(), parsed?.to)
        assertEquals("Notes", parsed?.subject)
    }

    @Test
    fun rejectsAnEmptyDraft() {
        // Nothing to show the user, so it is a failed translation rather than a
        // blank compose window they have to dismiss.
        assertNull(parseComposeEmailActionPayload(payload()))
        assertNull(parseComposeEmailActionPayload(payload("to" to JSONArray())))
    }

    @Test
    fun rejectsTheWholeActionWhenAnyAddressIsUnusable() {
        // Dropping the bad one would send a draft to fewer people than the user
        // asked for, and the model would never learn it got the address wrong.
        assertNull(
            parseComposeEmailActionPayload(
                payload("to" to JSONArray().put("ada@example.com").put("not an address"))
            )
        )
        assertNull(parseComposeEmailActionPayload(payload("cc" to JSONArray().put("ada@"))))
        assertNull(parseComposeEmailActionPayload(payload("bcc" to JSONArray().put("@example.com"))))
    }

    @Test
    fun rejectsAddressesThatAreReallyTwoAddressesRunTogether() {
        assertFalse(isSupportedEmailAddress("ada@example.com, grace@example.com"))
        assertFalse(isSupportedEmailAddress("ada@example.com grace@example.com"))
        assertFalse(isSupportedEmailAddress("Ada <ada@example.com>"))
    }

    @Test
    fun acceptsOrdinaryAddressesAndTrimsThem() {
        assertTrue(isSupportedEmailAddress("ada.lovelace+news@sub.example.co.uk"))
        assertEquals("ada@example.com", normalizeEmailAddress("  ada@example.com \n"))
    }

    @Test
    fun rejectsAddressesWithoutADottedDomain() {
        assertFalse(isSupportedEmailAddress("ada@localhost"))
        assertFalse(isSupportedEmailAddress("ada.example.com"))
    }

    @Test
    fun deduplicatesRepeatedRecipients() {
        val parsed = parseComposeEmailActionPayload(
            payload("to" to JSONArray().put("ada@example.com").put("ada@example.com"))
        )

        assertEquals(listOf("ada@example.com"), parsed?.to)
    }

    @Test
    fun rejectsTooManyRecipients() {
        val many = JSONArray()
        repeat(40) { many.put("user$it@example.com") }

        assertNull(parseComposeEmailActionPayload(payload("to" to many)))
    }

    @Test
    fun rejectsNonStringAndMalformedPayloads() {
        assertNull(parseComposeEmailActionPayload(null))
        assertNull(parseComposeEmailActionPayload("to: ada@example.com"))
        assertNull(parseComposeEmailActionPayload(payload("to" to 42)))
        assertNull(parseComposeEmailActionPayload(payload("to" to JSONArray().put(42))))
    }

    @Test
    fun treatsJsonNullAsAnAbsentField() {
        // org.json renders a JSON null as the literal string "null", which would
        // otherwise be validated as an address and fail the action.
        val parsed = parseComposeEmailActionPayload(
            payload("to" to JSONObject.NULL, "subject" to "Hi")
        )

        assertEquals(emptyList<String>(), parsed?.to)
        assertEquals("Hi", parsed?.subject)
    }

    @Test
    fun capsAnOverlongBodyRatherThanFailing() {
        val parsed = parseComposeEmailActionPayload(payload("body" to "x".repeat(20_000)))

        assertEquals(8_000, parsed?.body?.length)
    }
}
