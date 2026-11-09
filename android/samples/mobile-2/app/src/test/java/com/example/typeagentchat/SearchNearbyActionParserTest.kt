package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchNearbyActionParserTest {

    private fun payload(
        searchTerm: Any,
        request: String = "Find coffee shops near me"
    ) = JSONObject()
        .put("originalRequest", request)
        .put("searchTerm", searchTerm)

    @Test
    fun `parses search-nearby payload`() {
        val search = parseSearchNearbyActionPayload(payload("coffee shops"))

        requireNotNull(search)
        assertEquals("Find coffee shops near me", search.originalRequest)
        assertEquals("coffee shops", search.searchTerm)
    }

    @Test
    fun `trims and collapses whitespace in the search term`() {
        val search = parseSearchNearbyActionPayload(payload("  italian   restaurants \n"))

        requireNotNull(search)
        assertEquals("italian restaurants", search.searchTerm)
    }

    @Test
    fun `folds control characters out of the search term`() {
        val search = parseSearchNearbyActionPayload(payload("gas\u0000stations\tnearby"))

        requireNotNull(search)
        assertEquals("gas stations nearby", search.searchTerm)
    }

    @Test
    fun `rejects a blank or missing search term`() {
        assertNull(parseSearchNearbyActionPayload(payload("")))
        assertNull(parseSearchNearbyActionPayload(payload("   ")))
        assertNull(
            parseSearchNearbyActionPayload(JSONObject().put("originalRequest", "Find coffee"))
        )
    }

    @Test
    fun `rejects a non-string search term`() {
        // org.json would render these as "null"/"42" via optString, which would
        // be searched for verbatim.
        assertNull(parseSearchNearbyActionPayload(payload(JSONObject.NULL)))
        assertNull(parseSearchNearbyActionPayload(payload(42)))
    }

    @Test
    fun `rejects a non-object payload`() {
        assertNull(parseSearchNearbyActionPayload(null))
        assertNull(parseSearchNearbyActionPayload("coffee"))
    }

    @Test
    fun `caps an oversized search term`() {
        val search = parseSearchNearbyActionPayload(payload("a".repeat(10_000)))

        requireNotNull(search)
        assertEquals(256, search.searchTerm.length)
    }

    @Test
    fun `tolerates a missing or null originalRequest`() {
        val missing = parseSearchNearbyActionPayload(JSONObject().put("searchTerm", "pharmacy"))
        requireNotNull(missing)
        assertEquals("", missing.originalRequest)

        val explicitNull = parseSearchNearbyActionPayload(
            JSONObject()
                .put("originalRequest", JSONObject.NULL)
                .put("searchTerm", "pharmacy")
        )
        requireNotNull(explicitNull)
        assertEquals("", explicitNull.originalRequest)
    }

    @Test
    fun `caps an oversized originalRequest`() {
        val search = parseSearchNearbyActionPayload(payload("pharmacy", "a".repeat(10_000)))

        requireNotNull(search)
        assertEquals(256, search.originalRequest.length)
    }

    @Test
    fun `builds a geo search uri`() {
        assertEquals("geo:0,0?q=pharmacy", buildGeoSearchUri("pharmacy"))
    }

    @Test
    fun `percent-encodes spaces rather than emitting plus`() {
        // URLEncoder would emit "coffee+shops", which a maps app reads as a
        // literal '+' in the query rather than a separator.
        assertEquals("geo:0,0?q=coffee%20shops", buildGeoSearchUri("coffee shops"))
    }

    @Test
    fun `percent-encodes characters that would corrupt the query`() {
        assertEquals(
            "geo:0,0?q=bed%20%26%20breakfast",
            buildGeoSearchUri("bed & breakfast")
        )
        assertEquals("geo:0,0?q=%231%20pizza", buildGeoSearchUri("#1 pizza"))
        assertEquals("geo:0,0?q=a%3Db%3Fc", buildGeoSearchUri("a=b?c"))
    }

    @Test
    fun `percent-encodes non-ascii search terms as utf-8`() {
        assertEquals("geo:0,0?q=caf%C3%A9", buildGeoSearchUri("café"))
    }

    @Test
    fun `leaves unreserved characters unescaped`() {
        assertEquals("geo:0,0?q=A-Z_a.z~9", buildGeoSearchUri("A-Z_a.z~9"))
    }
}
