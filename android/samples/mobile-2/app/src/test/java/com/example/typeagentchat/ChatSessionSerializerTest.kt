package com.example.typeagentchat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatSessionSerializerTest {

    private fun session(
        conversationId: String? = "conversation-1",
        messages: List<Message>
    ) = PersistedChatSession(conversationId = conversationId, messages = messages)

    @Test
    fun `round trip preserves the transcript`() {
        val original = session(
            messages = listOf(
                Message(text = "what is on my list", isUser = true),
                Message(
                    segments = listOf(
                        MessageSegment("routed to list", MessageFormat.TEXT, MessageKind.INFO),
                        MessageSegment("- milk\n- eggs", MessageFormat.MARKDOWN)
                    ),
                    isUser = false,
                    requestId = "req-7",
                    isFinal = true
                )
            )
        )

        val decoded = ChatSessionSerializer.decode(ChatSessionSerializer.encode(original))

        assertEquals("conversation-1", decoded.conversationId)
        assertEquals(2, decoded.messages.size)
        assertEquals("what is on my list", decoded.messages[0].text)
        assertTrue(decoded.messages[0].isUser)
        assertEquals(original.messages[0].id, decoded.messages[0].id)

        val agent = decoded.messages[1]
        assertEquals("req-7", agent.requestId)
        assertEquals(MessageFormat.MARKDOWN, agent.format)
        assertEquals(MessageKind.INFO, agent.segments[0].kind)
        assertEquals("- milk\n- eggs", agent.segments[1].text)
    }

    @Test
    fun `restored messages are always sealed`() {
        val original = session(
            messages = listOf(
                Message(text = "streaming...", isUser = false, isFinal = false)
            )
        )

        val decoded = ChatSessionSerializer.decode(ChatSessionSerializer.encode(original))

        // An unsealed restored bubble would render "Responding..." forever and
        // could be retro-targeted by WebSocketManager.finalizeAssistantMessage.
        assertTrue(decoded.messages.single().isFinal)
    }

    @Test
    fun `only the most recent messages are persisted`() {
        val messages = (1..ChatSessionSerializer.MAX_PERSISTED_MESSAGES + 25).map {
            Message(text = "message $it", isUser = true)
        }

        val decoded = ChatSessionSerializer.decode(
            ChatSessionSerializer.encode(session(messages = messages))
        )

        assertEquals(ChatSessionSerializer.MAX_PERSISTED_MESSAGES, decoded.messages.size)
        assertEquals("message 26", decoded.messages.first().text)
        assertEquals(
            "message ${ChatSessionSerializer.MAX_PERSISTED_MESSAGES + 25}",
            decoded.messages.last().text
        )
    }

    @Test
    fun `a missing conversation id round trips as null`() {
        val decoded = ChatSessionSerializer.decode(
            ChatSessionSerializer.encode(
                session(conversationId = null, messages = listOf(Message(text = "hi", isUser = true)))
            )
        )

        assertNull(decoded.conversationId)
        assertEquals(1, decoded.messages.size)
    }

    @Test
    fun `an unknown payload version is ignored`() {
        val decoded = ChatSessionSerializer.decode(
            """{"version":99,"conversationId":"c","messages":[{"id":"a","segments":[]}]}"""
        )

        assertNull(decoded.conversationId)
        assertTrue(decoded.messages.isEmpty())
    }

    @Test
    fun `messages without usable segments are dropped`() {
        val decoded = ChatSessionSerializer.decode(
            """{"version":1,"messages":[{"id":"a","isUser":true},{"id":"b","segments":[]}]}"""
        )

        assertTrue(decoded.messages.isEmpty())
    }

    @Test
    fun `an empty session encodes and decodes cleanly`() {
        val decoded = ChatSessionSerializer.decode(
            ChatSessionSerializer.encode(PersistedChatSession.EMPTY)
        )

        assertNull(decoded.conversationId)
        assertTrue(decoded.messages.isEmpty())
    }

    @Test
    fun `messages past the retention window are not written`() {
        val now = 1_800_000_000_000L
        val day = 24L * 60 * 60 * 1000
        val messages = listOf(
            Message(text = "ancient", isUser = true, timestampMillis = now - 400 * day),
            Message(text = "old", isUser = true, timestampMillis = now - 31 * day),
            Message(text = "recent", isUser = true, timestampMillis = now - 2 * day),
            Message(text = "now", isUser = true, timestampMillis = now)
        )

        val decoded = ChatSessionSerializer.decode(
            ChatSessionSerializer.encode(session(messages = messages), now = now),
            now = now
        )

        assertEquals(listOf("recent", "now"), decoded.messages.map { it.text })
    }

    @Test
    fun `messages expire while the app is not running`() {
        val written = 1_800_000_000_000L
        val day = 24L * 60 * 60 * 1000
        val raw = ChatSessionSerializer.encode(
            session(messages = listOf(Message(text = "hi", isUser = true, timestampMillis = written))),
            now = written
        )

        // Same payload, read back long after it was written.
        val fresh = ChatSessionSerializer.decode(raw, now = written + 5 * day)
        val stale = ChatSessionSerializer.decode(raw, now = written + 45 * day)

        assertEquals(1, fresh.messages.size)
        assertTrue(stale.messages.isEmpty())
    }

    @Test
    fun `timestamps survive a round trip`() {
        val stamp = 1_700_000_000_000L
        val decoded = ChatSessionSerializer.decode(
            ChatSessionSerializer.encode(
                session(messages = listOf(Message(text = "hi", isUser = true, timestampMillis = stamp))),
                now = stamp
            ),
            now = stamp
        )

        assertEquals(stamp, decoded.messages.single().timestampMillis)
    }

    @Test
    fun `transcripts written before timestamps existed are kept`() {
        val now = 1_800_000_000_000L
        // A payload from the previous app version: no "timestamp" field.
        val legacy = """
            {"version":1,"conversationId":"c","messages":[
              {"id":"a","isUser":true,"segments":[{"text":"legacy","format":"TEXT","kind":"NONE"}]}
            ]}
        """.trimIndent()

        val decoded = ChatSessionSerializer.decode(legacy, now = now)

        assertEquals("legacy", decoded.messages.single().text)
        assertEquals(now, decoded.messages.single().timestampMillis)
    }

    @Test
    fun `a clock that jumps backwards does not delete live messages`() {
        val now = 1_800_000_000_000L
        val day = 24L * 60 * 60 * 1000
        // Message stamped in the future relative to `now`.
        val messages = listOf(Message(text = "future", isUser = true, timestampMillis = now + 10 * day))

        val decoded = ChatSessionSerializer.decode(
            ChatSessionSerializer.encode(session(messages = messages), now = now),
            now = now
        )

        assertEquals(1, decoded.messages.size)
    }

    @Test
    fun `a read that drops expired messages asks for the file to be rewritten`() {
        val written = 1_800_000_000_000L
        val day = 24L * 60 * 60 * 1000
        val raw = ChatSessionSerializer.encode(
            session(
                messages = listOf(
                    Message(text = "old", isUser = true, timestampMillis = written),
                    Message(text = "new", isUser = true, timestampMillis = written + 40 * day)
                )
            ),
            now = written
        )

        val decoded = ChatSessionSerializer.decodeDetailed(raw, now = written + 45 * day)

        // Without this signal the expired message stays in the file: filtering
        // on read only hides it from the UI.
        assertEquals(1, decoded.droppedCount)
        assertEquals(listOf("new"), decoded.session.messages.map { it.text })
    }

    @Test
    fun `a read with nothing to drop does not ask for a rewrite`() {
        val now = 1_800_000_000_000L
        val raw = ChatSessionSerializer.encode(
            session(messages = listOf(Message(text = "hi", isUser = true, timestampMillis = now))),
            now = now
        )

        assertEquals(0, ChatSessionSerializer.decodeDetailed(raw, now = now).droppedCount)
    }
}
