package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalPromptSubmissionTest {

    private val transport = TestWebSocketTransport()
    private val manager = WebSocketManager(TestDeviceIdentity(), transport)

    @Test
    fun `external prompt is submitted as a new command`() {
        connectAndRegister()

        assertTrue(manager.trySendExternalCommand("  set a timer  "))

        val invoke = transport.takeInvoke("submitCommand")
        assertEquals("set a timer", invoke.args.getString(0))
        assertEquals("set a timer", manager.messages.value.last().text)
    }

    @Test
    fun `external prompt cannot answer a pending confirmation`() {
        connectAndRegister()
        transport.deliverCall(
            channelName = "clientio:$CONVERSATION_ID",
            methodName = "requestChoice",
            args = JSONArray()
                .put(JSONObject().put("requestId", "request-1"))
                .put("choice-1")
                .put("yesNo")
                .put("Continue?")
                .put(JSONArray().put("Yes").put("No"))
        )

        assertFalse(manager.trySendExternalCommand("yes"))
        assertNull(transport.nextInvokeOrNull())
    }

    @Test
    fun `external prompt stays with caller until conversation is ready`() {
        assertFalse(manager.trySendExternalCommand("hello"))
        assertNull(transport.nextInvokeOrNull())
    }

    @Test
    fun `external prompt stays with caller when socket rejects send`() {
        connectAndRegister()
        transport.rejectNextSend()

        assertFalse(manager.trySendExternalCommand("keep this prompt"))
        assertFalse(manager.messages.value.any { it.text == "keep this prompt" })
        assertNull(transport.nextInvokeOrNull())
    }

    private fun connectAndRegister() {
        manager.connect(
            url = "ws://localhost:8080/",
            schemaContent = "export type AndroidDeviceAction = never;"
        )
        transport.open()
        transport.takeInvoke("joinConversation").succeed(
            JSONObject()
                .put("conversationId", CONVERSATION_ID)
                .put("connectionId", "connection-1")
        )
        transport.takeInvoke("registerClientAgent").succeed()
    }

    private companion object {
        const val CONVERSATION_ID = "conversation-1"
    }
}
