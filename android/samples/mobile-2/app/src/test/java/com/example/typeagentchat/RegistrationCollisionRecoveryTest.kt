package com.example.typeagentchat

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A registration that outlived its socket is still listed for the conversation
 * but routes actions into the dead connection, so adopting it leaves the device
 * unreachable. Recovery has to evict it and register again, and it has to stop
 * after one attempt so a collision it cannot clear does not loop.
 */
class RegistrationCollisionRecoveryTest {

    private val transport = FakeTransport()
    private val manager = WebSocketManager(transport)

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

    /**
     * A [WebSocket.Factory] that hands back a socket which records the frames
     * the manager sends and lets the test answer them, so the whole handshake
     * runs over the real wire format without a server.
     */
    private class FakeTransport : WebSocket.Factory {
        private var listener: WebSocketListener? = null
        private var socket: FakeWebSocket? = null

        override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket {
            val created = FakeWebSocket()
            this.listener = listener
            this.socket = created
            return created
        }

        fun open() {
            val current = requireNotNull(socket) { "connect() was not called" }
            requireNotNull(listener).onOpen(
                current,
                Response.Builder()
                    .request(current.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(101)
                    .message("Switching Protocols")
                    .build()
            )
        }

        fun nextInvokeOrNull(): SentInvoke? {
            val frame = requireNotNull(socket).sentFrames.removeFirstOrNull() ?: return null
            val message = JSONObject(frame).getJSONObject("message")
            return SentInvoke(
                transport = this,
                channelName = JSONObject(frame).getString("name"),
                methodName = message.getString("name"),
                callId = message.getInt("callId"),
                args = message.getJSONArray("args")
            )
        }

        fun takeInvoke(expectedMethodName: String): SentInvoke {
            val invoke = requireNotNull(nextInvokeOrNull()) {
                "expected an invoke of $expectedMethodName, but nothing was sent"
            }
            assertEquals(expectedMethodName, invoke.methodName)
            return invoke
        }

        fun deliver(channelName: String, message: JSONObject) {
            val current = requireNotNull(socket)
            requireNotNull(listener).onMessage(
                current,
                JSONObject()
                    .put("name", channelName)
                    .put("message", message)
                    .toString()
            )
        }
    }

    private class SentInvoke(
        private val transport: FakeTransport,
        val channelName: String,
        val methodName: String,
        val callId: Int,
        val args: JSONArray
    ) {
        fun firstArg(): JSONObject = args.getJSONObject(0)

        fun succeed(result: Any? = null) {
            transport.deliver(
                channelName,
                JSONObject()
                    .put("type", "invokeResult")
                    .put("callId", callId)
                    .putOpt("result", result)
            )
        }

        fun failWith(error: String) {
            transport.deliver(
                channelName,
                JSONObject()
                    .put("type", "invokeError")
                    .put("callId", callId)
                    .put("error", error)
            )
        }
    }

    private class FakeWebSocket : WebSocket {
        val sentFrames = ArrayDeque<String>()

        override fun request(): Request =
            Request.Builder().url("http://localhost:8080/").build()

        override fun queueSize(): Long = 0

        override fun send(text: String): Boolean {
            sentFrames.addLast(text)
            return true
        }

        override fun send(bytes: ByteString): Boolean = true

        override fun close(code: Int, reason: String?): Boolean = true

        override fun cancel() = Unit
    }

    private companion object {
        const val CONVERSATION_ID = "conversation-1"
    }
}
