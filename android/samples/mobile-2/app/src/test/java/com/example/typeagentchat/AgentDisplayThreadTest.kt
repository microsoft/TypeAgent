package com.example.typeagentchat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentDisplayThreadTest {

    private fun text(value: String) = ParsedDisplayContent(value, MessageFormat.TEXT)

    private fun markdown(value: String) = ParsedDisplayContent(value, MessageFormat.MARKDOWN)

    private fun info(value: String) =
        ParsedDisplayContent(value, MessageFormat.TEXT, MessageKind.INFO)

    @Test
    fun `temporary status updates are flushed by the final result`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Translating 'create grocery list'"), DisplayAppendMode.TEMPORARY)
        thread.setMessage(text("routed to list"), DisplayAppendMode.TEMPORARY)
        thread.setMessage(text("recent topic"), DisplayAppendMode.TEMPORARY)
        thread.setMessage(text("Created list: grocery"), DisplayAppendMode.BLOCK)

        assertEquals("Created list: grocery", thread.render().text)
    }

    @Test
    fun `set display replaces everything already rendered`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("partial"), DisplayAppendMode.BLOCK)
        thread.setMessage(text("more"), DisplayAppendMode.BLOCK)
        thread.setMessage(text("Created list: grocery"), DisplayAppendMode.REPLACE)

        assertEquals("Created list: grocery", thread.render().text)
    }

    @Test
    fun `temporary content is visible until the next update`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Thinking..."), DisplayAppendMode.TEMPORARY)

        assertEquals("Thinking...", thread.render().text)
    }

    @Test
    fun `flush temporary removes a trailing status`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Answer"), DisplayAppendMode.BLOCK)
        thread.setMessage(text("Thinking..."), DisplayAppendMode.TEMPORARY)
        assertTrue(thread.flushTemporary())

        assertEquals("Answer", thread.render().text)
    }

    @Test
    fun `flush temporary is a no-op after a block append`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Answer"), DisplayAppendMode.BLOCK)

        assertEquals(false, thread.flushTemporary())
        assertEquals("Answer", thread.render().text)
    }

    @Test
    fun `empty temporary content does not consume a real chunk`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Answer"), DisplayAppendMode.BLOCK)
        thread.setMessage(text(""), DisplayAppendMode.TEMPORARY)
        thread.setMessage(text("More"), DisplayAppendMode.BLOCK)

        assertEquals("Answer\n\nMore", thread.render().text)
    }

    @Test
    fun `consecutive inline appends merge into one chunk`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Hello"), DisplayAppendMode.INLINE)
        thread.setMessage(text(" world"), DisplayAppendMode.INLINE)

        assertEquals("Hello world", thread.render().text)
    }

    @Test
    fun `first inline after a block starts a new chunk`() {
        val thread = AgentDisplayThread()

        thread.setMessage(text("Block"), DisplayAppendMode.BLOCK)
        thread.setMessage(text("Inline"), DisplayAppendMode.INLINE)

        assertEquals("Block\n\nInline", thread.render().text)
    }

    @Test
    fun `blocks are separated so markdown stays valid`() {
        val thread = AgentDisplayThread()

        thread.setMessage(markdown("### Lists"), DisplayAppendMode.BLOCK)
        thread.setMessage(markdown("1. grocery"), DisplayAppendMode.BLOCK)

        val rendered = thread.render()
        assertEquals("### Lists\n\n1. grocery", rendered.text)
        assertEquals(MessageFormat.MARKDOWN, rendered.format)
    }

    @Test
    fun `append mode parsing matches the agent sdk values`() {
        assertEquals(DisplayAppendMode.INLINE, parseDisplayAppendMode("inline"))
        assertEquals(DisplayAppendMode.TEMPORARY, parseDisplayAppendMode("temporary"))
        assertEquals(DisplayAppendMode.STEP, parseDisplayAppendMode("step"))
        assertEquals(DisplayAppendMode.BLOCK, parseDisplayAppendMode("block"))
        assertEquals(DisplayAppendMode.BLOCK, parseDisplayAppendMode(null))
        assertEquals(DisplayAppendMode.BLOCK, parseDisplayAppendMode(""))
    }

    @Test
    fun `toast and inline kinds stay out of the bubble`() {
        assertTrue(isEphemeralAgentMessageKind("toast"))
        assertTrue(isEphemeralAgentMessageKind("inline"))
        assertEquals(false, isEphemeralAgentMessageKind(null))
        assertEquals(false, isEphemeralAgentMessageKind("notification"))
    }

    @Test
    fun `routing note keeps its info kind alongside the answer`() {
        val thread = AgentDisplayThread()

        thread.setMessage(info("\u21aa routed to list \u2014 recent topic"), DisplayAppendMode.BLOCK)
        thread.setMessage(text("Created list: to-do"), DisplayAppendMode.BLOCK)

        val segments = thread.render().segments
        assertEquals(2, segments.size)
        assertEquals(MessageKind.INFO, segments[0].kind)
        assertEquals("\u21aa routed to list \u2014 recent topic", segments[0].text)
        assertEquals(MessageKind.NONE, segments[1].kind)
        assertEquals("Created list: to-do", segments[1].text)
    }

    @Test
    fun `inline appends do not merge across different kinds`() {
        val thread = AgentDisplayThread()

        thread.setMessage(info("note"), DisplayAppendMode.INLINE)
        thread.setMessage(text(" answer"), DisplayAppendMode.INLINE)

        val segments = thread.render().segments
        assertEquals(2, segments.size)
        assertEquals(MessageKind.INFO, segments[0].kind)
        assertEquals(MessageKind.NONE, segments[1].kind)
    }

    @Test
    fun `display message kind parsing`() {
        assertEquals(MessageKind.INFO, MessageKind.parse("info"))
        assertEquals(MessageKind.STATUS, MessageKind.parse("status"))
        assertEquals(MessageKind.WARNING, MessageKind.parse("warning"))
        assertEquals(MessageKind.ERROR, MessageKind.parse("error"))
        assertEquals(MessageKind.SUCCESS, MessageKind.parse("success"))
        assertEquals(MessageKind.NONE, MessageKind.parse(null))
        assertEquals(MessageKind.NONE, MessageKind.parse(""))
    }
}
