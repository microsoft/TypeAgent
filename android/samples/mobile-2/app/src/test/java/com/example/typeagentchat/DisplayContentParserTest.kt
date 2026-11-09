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
    fun `suppresses reasoning tool traces in html content`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "html")
                        .put(
                            "content",
                            "<summary>Thinking</summary>reasoning-tools-call tool=discover-actions then execute_actions androidMobile.setAlarm"
                        )
                )
        )

        assertEquals("", display.text)
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

    @Test
    fun `carries the display message kind`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "text")
                        .put("content", "\u21aa routed to list \u2014 recent topic")
                        .put("kind", "info")
                )
        )

        assertEquals(MessageKind.INFO, display.kind)
        assertEquals("\u21aa routed to list \u2014 recent topic", display.text)
    }

    @Test
    fun `defaults to no kind when absent`() {
        val display = extractAgentMessageContent(
            JSONObject()
                .put(
                    "message",
                    JSONObject()
                        .put("type", "text")
                        .put("content", "Created list: to-do")
                )
        )

        assertEquals(MessageKind.NONE, display.kind)
    }

    @Test
    fun `reads the agent message kind for ephemeral routing`() {
        val agentMessage = JSONObject()
            .put("kind", "toast")
            .put("message", "hi")

        assertEquals("toast", extractAgentMessageKind(agentMessage))
        assertEquals(null, extractAgentMessageKind(JSONObject().put("message", "hi")))
    }
}
