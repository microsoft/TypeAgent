package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayMusicFromSearchActionParserTest {
    private fun payload(query: Any?, focus: Any? = null): JSONObject =
        JSONObject()
            .put("originalRequest", "Play some music")
            .put("query", query)
            .apply { if (focus != null) put("focus", focus) }

    @Test
    fun parsesAQueryAndDefaultsTheFocusToAny() {
        val parsed = parsePlayMusicFromSearchActionPayload(payload("Kind of Blue"))

        assertEquals("Kind of Blue", parsed?.query)
        assertEquals(MusicSearchFocus.Any, parsed?.focus)
    }

    @Test
    fun parsesEverySchemaNameTheEnumDeclares() {
        MusicSearchFocus.entries.forEach { focus ->
            assertEquals(
                "Focus ${focus.schemaName} should parse",
                focus,
                parsePlayMusicFromSearchActionPayload(payload("anything", focus.schemaName))?.focus
            )
        }
    }

    @Test
    fun acceptsDifferentCasingFromTheModel() {
        assertEquals(
            MusicSearchFocus.Artist,
            parsePlayMusicFromSearchActionPayload(payload("Miles Davis", "ARTIST"))?.focus
        )
    }

    @Test
    fun rejectsAnUnknownFocusRatherThanFallingBackToAny() {
        // Falling back would look like success while searching for something
        // broader than the user asked for.
        assertNull(parsePlayMusicFromSearchActionPayload(payload("Miles Davis", "composer")))
        assertNull(parsePlayMusicFromSearchActionPayload(payload("Miles Davis", 3)))
    }

    @Test
    fun treatsAnAbsentOrNullFocusAsAny() {
        assertEquals(
            MusicSearchFocus.Any,
            parsePlayMusicFromSearchActionPayload(payload("jazz", JSONObject.NULL))?.focus
        )
    }

    @Test
    fun requiresAQuery() {
        assertNull(parsePlayMusicFromSearchActionPayload(payload("")))
        assertNull(parsePlayMusicFromSearchActionPayload(payload("  ")))
        assertNull(parsePlayMusicFromSearchActionPayload(payload(JSONObject.NULL)))
        assertNull(parsePlayMusicFromSearchActionPayload(JSONObject()))
        assertNull(parsePlayMusicFromSearchActionPayload(null))
        assertNull(parsePlayMusicFromSearchActionPayload("jazz"))
    }

    @Test
    fun collapsesControlCharactersInTheQuery() {
        val parsed = parsePlayMusicFromSearchActionPayload(payload("Kind\nof\tBlue"))

        assertEquals("Kind of Blue", parsed?.query)
    }

    @Test
    fun capsAnOverlongQuery() {
        val parsed = parsePlayMusicFromSearchActionPayload(payload("x".repeat(1_000)))

        assertTrue((parsed?.query?.length ?: 0) <= MAX_ACTION_TEXT_CHARS)
    }
}
