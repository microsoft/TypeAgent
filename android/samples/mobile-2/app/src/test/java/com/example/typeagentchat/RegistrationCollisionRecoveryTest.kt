package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A registration that outlived its socket is still listed for the conversation
 * but routes actions into the dead connection, so adopting it leaves the device
 * unreachable. Recovery has to evict it and register again, and it has to stop
 * after one attempt so a collision it cannot clear does not loop.
 */
class RegistrationCollisionRecoveryTest {

    private val transport = TestWebSocketTransport()
    private val manager = WebSocketManager(TestDeviceIdentity(), transport)

    @Test
    fun `a collision evicts the stale registration and registers again`() {
        connectAndJoin()

        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")

        val unregister = transport.takeInvoke("unregisterClientAgent")
        assertEquals(AndroidDeviceAgent.NAME, unregister.firstArg().getString("name"))
        assertEquals(CONVERSATION_ID, unregister.firstArg().getString("conversationId"))
        assertEquals(
            WebSocketManager.STATUS_AGENT_REGISTRATION_RECLAIMING,
            manager.connectionStatus.value.text
        )
        unregister.succeed()

        transport.takeInvoke("registerClientAgent").succeed()

        assertEquals(
            WebSocketManager.STATUS_AGENT_REGISTERED,
            manager.connectionStatus.value.text
        )
        assertEquals(
            ConnectionStatus.State.CONNECTED,
            manager.connectionStatus.value.state
        )
    }

    @Test
    fun `an eviction that fails falls back to the stale registration`() {
        connectAndJoin()

        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")
        transport.takeInvoke("unregisterClientAgent").failWith("Conversation not found")

        assertEquals(
            WebSocketManager.STATUS_AGENT_REGISTRATION_REUSED,
            manager.connectionStatus.value.text
        )
        // Still connected: chat keeps working even though actions do not reach
        // this device.
        assertEquals(
            ConnectionStatus.State.CONNECTED,
            manager.connectionStatus.value.state
        )
        assertNull(transport.nextInvokeOrNull())
    }

    @Test
    fun `a second collision on the same connection does not evict again`() {
        connectAndJoin()

        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")
        transport.takeInvoke("unregisterClientAgent").succeed()
        // The eviction did not clear the entry, so evicting again would spin.
        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")

        assertNull(transport.nextInvokeOrNull())
        assertEquals(
            WebSocketManager.STATUS_AGENT_REGISTRATION_REUSED,
            manager.connectionStatus.value.text
        )
    }

    @Test
    fun `reconnecting lets the recovery run again`() {
        connectAndJoin()
        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")
        transport.takeInvoke("unregisterClientAgent").failWith("Conversation not found")

        connectAndJoin()
        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")

        assertEquals(
            "unregisterClientAgent",
            transport.takeInvoke("unregisterClientAgent").methodName
        )
    }

    @Test
    fun `a registration failure that is not a collision still surfaces`() {
        connectAndJoin()

        transport.takeInvoke("registerClientAgent")
            .failWith("Unhandled type node ParenthesizedType")

        assertEquals(ConnectionStatus.State.ERROR, manager.connectionStatus.value.state)
        assertNull(transport.nextInvokeOrNull())
    }

    @Test
    fun `a late eviction result from a replaced connection is dropped`() {
        connectAndJoin()
        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")
        val staleUnregister = transport.takeInvoke("unregisterClientAgent")

        connectAndJoin()
        val registerOnNewConnection = transport.takeInvoke("registerClientAgent")
        staleUnregister.succeed()

        // The superseded eviction must not register over the live connection.
        assertNull(transport.nextInvokeOrNull())
        registerOnNewConnection.succeed()
        assertEquals(
            WebSocketManager.STATUS_AGENT_REGISTERED,
            manager.connectionStatus.value.text
        )
    }

    @Test
    fun `registration carries this device's identity`() {
        connectAndJoin()

        val register = transport.takeInvoke("registerClientAgent")
        assertEquals("device-under-test", register.firstArg().getString("instanceId"))
        assertEquals("Test Phone", register.firstArg().getString("displayName"))
        // Without this the server rejects the second device, the same way it
        // does for a client that expects to be the only host of its agent.
        assertEquals(true, register.firstArg().getBoolean("multiInstance"))
        register.succeed()
    }

    @Test
    fun `the eviction call names no instance`() {
        connectAndJoin()

        transport.takeInvoke("registerClientAgent")
            .failWith("App agent 'androidDevice' already exists")

        val unregister = transport.takeInvoke("unregisterClientAgent")
        // Naming an instance would let this shim drop another device's live
        // registration; against a fixed server the call must stay inert.
        assertFalse(unregister.firstArg().has("instanceId"))
    }

    /** Connects, opens the socket, and answers `joinConversation`. */
    private fun connectAndJoin() {
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
    }

    private companion object {
        const val CONVERSATION_ID = "conversation-1"
    }
}
