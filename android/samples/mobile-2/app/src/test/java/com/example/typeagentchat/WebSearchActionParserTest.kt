package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WebSearchActionParserTest {
    private fun payload(query: Any?): JSONObject =
        JSONObject()
            .put("originalRequest", "Search for tide tables")
            .put("query", query)

    @Test
    fun parsesQuery() {
        val parsed = parseWebSearchActionPayload(payload("tide tables puget sound"))

        assertEquals("tide tables puget sound", parsed?.query)
        assertEquals("Search for tide tables", parsed?.originalRequest)
    }

    @Test
    fun leavesUriMetacharactersAloneBecauseTheQueryTravelsAsAnExtra() {
        // Nothing is spliced into a URL here, so '&' and '?' need no encoding.
        val parsed = parseWebSearchActionPayload(payload("cats & dogs? yes"))

        assertEquals("cats & dogs? yes", parsed?.query)
    }

    @Test
    fun collapsesWhitespaceRuns() {
        val parsed = parseWebSearchActionPayload(payload("  weather   in\nseattle  "))

        assertEquals("weather in seattle", parsed?.query)
    }

    @Test
    fun capsOverlongQueries() {
        val parsed = parseWebSearchActionPayload(payload("b".repeat(500)))

        assertEquals(MAX_ACTION_TEXT_CHARS, parsed?.query?.length)
    }

    @Test
    fun rejectsMissingBlankAndNonStringQueries() {
        assertNull(parseWebSearchActionPayload(JSONObject()))
        assertNull(parseWebSearchActionPayload(payload("   ")))
        assertNull(parseWebSearchActionPayload(payload(JSONObject.NULL)))
        assertNull(parseWebSearchActionPayload(payload(7)))
        assertNull(parseWebSearchActionPayload(null))
        assertNull(parseWebSearchActionPayload("weather"))
    }
}
