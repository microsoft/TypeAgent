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

internal class TestWebSocketTransport : WebSocket.Factory {
    private var listener: WebSocketListener? = null
    private var socket: TestWebSocket? = null

    override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket {
        val created = TestWebSocket()
        this.listener = listener
        socket = created
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
        val frame = socket?.sentFrames?.removeFirstOrNull() ?: return null
        val envelope = JSONObject(frame)
        val message = envelope.getJSONObject("message")
        return SentInvoke(
            transport = this,
            channelName = envelope.getString("name"),
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

    fun deliverCall(channelName: String, methodName: String, args: JSONArray) {
        deliver(
            channelName,
            JSONObject()
                .put("type", "call")
                .put("name", methodName)
                .put("args", args)
        )
    }

    fun rejectNextSend() {
        requireNotNull(socket).rejectNextSend = true
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

internal class SentInvoke(
    private val transport: TestWebSocketTransport,
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

private class TestWebSocket : WebSocket {
    val sentFrames = ArrayDeque<String>()
    var rejectNextSend = false

    override fun request(): Request =
        Request.Builder().url("http://localhost:8080/").build()

    override fun queueSize(): Long = 0

    override fun send(text: String): Boolean {
        if (rejectNextSend) {
            rejectNextSend = false
            return false
        }
        sentFrames.addLast(text)
        return true
    }

    override fun send(bytes: ByteString): Boolean = true

    override fun close(code: Int, reason: String?): Boolean = true

    override fun cancel() = Unit
}

/**
 * Stands in for [StoredDeviceIdentity], which needs a Context these JVM tests do
 * not have.
 */
internal class TestDeviceIdentity : DeviceIdentity {
    override val instanceId = "device-under-test"
    override val displayName = "Test Phone"
}
