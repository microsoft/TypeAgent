package com.example.typeagentchat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The resume flow only falls back to the default conversation for this one
 * server error. Transport, auth and permission failures must keep surfacing as
 * connection errors, otherwise a temporary outage would silently drop the user
 * into a different conversation than the one they were reading.
 */
class ConversationNotFoundErrorTest {

    @Test
    fun `the server's missing-conversation error is recognised`() {
        assertTrue(isConversationNotFoundError("Conversation not found: abc-123"))
        assertTrue(isConversationNotFoundError("Conversation not found"))
    }

    @Test
    fun `leading whitespace from RPC wrapping does not hide it`() {
        assertTrue(isConversationNotFoundError("  Conversation not found: abc-123"))
    }

    @Test
    fun `other failures do not trigger the fallback`() {
        assertFalse(isConversationNotFoundError("Disconnected"))
        assertFalse(isConversationNotFoundError("Tunnel auth failed. Check token."))
        assertFalse(isConversationNotFoundError("WebSocket is not connected."))
        // Must not match on a mere mention of the phrase mid-message.
        assertFalse(isConversationNotFoundError("Error: Conversation not found"))
        assertFalse(isConversationNotFoundError(""))
        assertFalse(isConversationNotFoundError(null))
    }
}
