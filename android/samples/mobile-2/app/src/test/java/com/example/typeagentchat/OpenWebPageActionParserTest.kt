package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenWebPageActionParserTest {
    private fun payload(url: Any?): JSONObject =
        JSONObject()
            .put("originalRequest", "Open the docs")
            .put("url", url)

    @Test
    fun parsesHttpAndHttpsUrls() {
        assertEquals(
            "https://example.com/docs?page=2#intro",
            parseOpenWebPageActionPayload(payload("https://example.com/docs?page=2#intro"))?.url
        )
        assertEquals(
            "http://example.com",
            parseOpenWebPageActionPayload(payload("http://example.com"))?.url
        )
    }

    @Test
    fun acceptsUppercaseSchemesButNormalizesThemForIntentMatching() {
        // Intent filter scheme matching is case-sensitive and the manifest
        // declares lowercase http/https, so an un-normalized "HTTPS://" would
        // resolve to nothing and be reported as "no browser available".
        assertTrue(isSupportedWebUrl("HTTPS://example.com"))
        assertEquals("https://example.com", normalizeWebUrl("HTTPS://example.com"))
        assertEquals(
            "http://example.com/Docs",
            parseOpenWebPageActionPayload(payload("HtTp://example.com/Docs"))?.url
        )
    }

    @Test
    fun leavesTheRestOfTheUrlUntouchedWhenNormalizing() {
        // Only the scheme is case-insensitive; paths and queries are not.
        assertEquals(
            "https://example.com/A/b?Q=Zed#Frag",
            normalizeWebUrl("https://example.com/A/b?Q=Zed#Frag")
        )
    }

    @Test
    fun rejectsEverySchemeOutsideTheAllowlist() {
        // ACTION_VIEW would follow any of these into whichever app claimed the
        // scheme, so the allowlist is the load-bearing check.
        assertFalse(isSupportedWebUrl("market://details?id=com.example"))
        assertFalse(isSupportedWebUrl("file:///sdcard/secrets.txt"))
        assertFalse(isSupportedWebUrl("javascript:alert(1)"))
        assertFalse(isSupportedWebUrl("intent://scan#Intent;scheme=zxing;end"))
        assertFalse(isSupportedWebUrl("content://com.example.provider/data"))
        assertFalse(isSupportedWebUrl("tel:5550100"))
    }

    @Test
    fun rejectsRelativeAndHostlessUrls() {
        assertFalse(isSupportedWebUrl("example.com"))
        assertFalse(isSupportedWebUrl("//example.com"))
        assertFalse(isSupportedWebUrl("/docs/index.html"))
        assertFalse(isSupportedWebUrl("http:/example.com"))
        assertFalse(isSupportedWebUrl("https://"))
    }

    @Test
    fun rejectsMalformedUrls() {
        assertFalse(isSupportedWebUrl("http://exa mple.com"))
        assertFalse(isSupportedWebUrl("https://exa^mple.com"))
    }

    @Test
    fun rejectsUrlsBrokenByWhitespaceRatherThanRepairingThem() {
        // Stripping the space would silently produce "https://example.com" - a
        // host the model never named.
        assertNull(parseOpenWebPageActionPayload(payload("https://exa mple.com")))
        assertNull(parseOpenWebPageActionPayload(payload("https://example.com/a\nb")))
    }

    @Test
    fun trimsSurroundingWhitespace() {
        assertEquals(
            "https://example.com",
            parseOpenWebPageActionPayload(payload("  https://example.com\n"))?.url
        )
    }

    @Test
    fun rejectsOverlongUrls() {
        val long = "https://example.com/" + "a".repeat(2_100)

        assertNull(parseOpenWebPageActionPayload(payload(long)))
    }

    @Test
    fun rejectsMissingBlankAndNonStringUrls() {
        assertNull(parseOpenWebPageActionPayload(JSONObject()))
        assertNull(parseOpenWebPageActionPayload(payload("   ")))
        assertNull(parseOpenWebPageActionPayload(payload(JSONObject.NULL)))
        assertNull(parseOpenWebPageActionPayload(payload(1)))
        assertNull(parseOpenWebPageActionPayload(null))
        assertNull(parseOpenWebPageActionPayload("https://example.com"))
    }
}
