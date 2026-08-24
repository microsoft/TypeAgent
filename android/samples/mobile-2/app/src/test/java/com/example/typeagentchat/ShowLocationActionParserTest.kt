package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShowLocationActionParserTest {
    private fun payload(location: Any?): JSONObject =
        JSONObject()
            .put("originalRequest", "Where is the Space Needle?")
            .put("location", location)

    @Test
    fun parsesLocation() {
        val parsed = parseShowLocationActionPayload(payload("Space Needle, Seattle"))

        assertEquals("Space Needle, Seattle", parsed?.location)
        assertEquals("Where is the Space Needle?", parsed?.originalRequest)
    }

    @Test
    fun foldsNewlinesIntoSpaces() {
        val parsed = parseShowLocationActionPayload(payload("400 Broad St\nSeattle,\tWA"))

        assertEquals("400 Broad St Seattle, WA", parsed?.location)
    }

    @Test
    fun capsOverlongLocations() {
        val parsed = parseShowLocationActionPayload(payload("a".repeat(400)))

        assertEquals(MAX_ACTION_TEXT_CHARS, parsed?.location?.length)
    }

    @Test
    fun rejectsMissingBlankAndNonStringLocations() {
        assertNull(parseShowLocationActionPayload(JSONObject()))
        assertNull(parseShowLocationActionPayload(payload("   ")))
        // org.json renders a JSON null as the string "null"; it must not be
        // mistaken for a place name.
        assertNull(parseShowLocationActionPayload(payload(JSONObject.NULL)))
        assertNull(parseShowLocationActionPayload(payload(42)))
        assertNull(parseShowLocationActionPayload(null))
        assertNull(parseShowLocationActionPayload("Seattle"))
    }

    @Test
    fun buildsTheSameGeoUriShapeAsSearchNearby() {
        assertEquals("geo:0,0?q=Space%20Needle", buildGeoSearchUri("Space Needle"))
    }
}
