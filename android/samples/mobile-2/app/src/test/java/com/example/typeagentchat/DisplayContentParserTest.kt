package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class DisplayContentParserTest {
    @Test
    fun `prefers markdown typed content`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "markdown")
                        .put("content", "### Lists\n1. list")
                )
        )

        assertEquals(MessageFormat.MARKDOWN, display.format)
        assertEquals("### Lists\n1. list", display.text)
    }

    @Test
    fun `falls back to markdown alternate for html content`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "html")
                        .put("content", "<h3>Lists</h3>")
                        .put(
                            "alternates",
                            JSONArray()
                                .put(
                                    JSONObject()
                                        .put("type", "markdown")
                                        .put("content", "### Lists")
                                )
                        )
                )
        )

        assertEquals(MessageFormat.MARKDOWN, display.format)
        assertEquals("### Lists", display.text)
    }

    @Test
    fun `strips tags when html has no safe alternate`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "html")
                        .put("content", "<h3>Lists</h3><script>alert(1)</script>")
                )
        )

        assertEquals(MessageFormat.TEXT, display.format)
        assertEquals("Lists alert(1)", display.text)
    }

    @Test
    fun `returns friendly fallback for structured content without alternates`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "structured")
                        .put("blocks", JSONArray())
                )
        )

        assertEquals(MessageFormat.TEXT, display.format)
        assertEquals("Structured content is not supported in this client yet.", display.text)
    }

    @Test
    fun `converts markdown tables from array content`() {
        val table = JSONArray()
            .put(JSONArray().put("Name").put("Value"))
            .put(JSONArray().put("Color").put("Blue"))

        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "markdown")
                        .put("content", table)
                )
        )

        assertEquals(
            "| Name | Value |\n| --- | --- |\n| Color | Blue |",
            display.text
        )
    }
}
