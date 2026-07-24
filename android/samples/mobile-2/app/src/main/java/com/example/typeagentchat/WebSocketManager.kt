package com.example.typeagentchat

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class WebSocketManager {

    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val lock = Any()
    private val nextCallId = AtomicInteger(0)
    private val connectionGeneration = AtomicInteger(0)
    private val pendingInvokes = mutableMapOf<Int, PendingInvoke>()

    private var webSocket: WebSocket? = null
    private var conversationId: String? = null
    private var connectionId: String? = null

    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages

    private val _connectionStatus = MutableStateFlow(
        ConnectionStatus(
            text = "Disconnected",
            state = ConnectionStatus.State.DISCONNECTED
        )
    )
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus

    fun connect(
        url: String,
        tunnelToken: String? = null
    ) {
        val targetUrl = url.trim()
        if (targetUrl.isBlank()) {
            val errorMessage = "Missing TYPEAGENT_SERVER_URL. Set it before building the app."
            Log.e(TAG, errorMessage)
            _connectionStatus.value = ConnectionStatus(
                text = errorMessage,
                state = ConnectionStatus.State.ERROR
            )
            return
        }

        synchronized(lock) {
            pendingInvokes.clear()
            conversationId = null
            connectionId = null
        }
        webSocket?.cancel()
        val generation = connectionGeneration.incrementAndGet()
        _connectionStatus.value = ConnectionStatus(
            text = "Connecting...",
            state = ConnectionStatus.State.CONNECTING
        )

        val requestBuilder = Request.Builder().url(targetUrl)
        val trimmedToken = tunnelToken?.trim().orEmpty()
        if (trimmedToken.isNotEmpty()) {
            requestBuilder.header("X-Tunnel-Authorization", "tunnel $trimmedToken")
        }
        val request = requestBuilder.build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (connectionGeneration.get() != generation) return
                Log.d(TAG, "WebSocket connected")
                joinConversation()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleIncomingFrame(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket disconnecting: code=$code reason=$reason")
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (connectionGeneration.get() != generation) return
                Log.d(TAG, "WebSocket disconnected: code=$code reason=$reason")
                failPendingInvokes("Disconnected")
                synchronized(lock) {
                    conversationId = null
                    connectionId = null
                }
                _connectionStatus.value = ConnectionStatus(
                    text = "Disconnected",
                    state = ConnectionStatus.State.DISCONNECTED
                )
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (connectionGeneration.get() != generation) return
                val responseCode = response?.code
                val errorMessage = when (responseCode) {
                    401, 403 -> "Tunnel auth failed. Check token."
                    else -> t.message ?: "Unknown WebSocket error"
                }
                Log.e(TAG, "WebSocket error: $errorMessage", t)
                failPendingInvokes(errorMessage)
                _connectionStatus.value = ConnectionStatus(
                    text = "Error: $errorMessage",
                    state = ConnectionStatus.State.ERROR
                )
            }
        })
    }

    fun sendMessage(text: String) {
        val message = text.trim()
        if (message.isBlank()) {
            return
        }

        val currentSocket = webSocket
        val currentConversationId = synchronized(lock) { conversationId }
        if (currentSocket == null || currentConversationId.isNullOrBlank()) {
            val errorMessage = "Not connected to TypeAgent yet."
            Log.e(TAG, errorMessage)
            _connectionStatus.value = ConnectionStatus(
                text = errorMessage,
                state = ConnectionStatus.State.ERROR
            )
            return
        }

        appendUserMessage(message)

        sendInvoke(
            channelName = dispatcherChannelName(currentConversationId),
            methodName = "submitCommand",
            args = listOf(message),
            onResult = { result ->
                val payload = result as? JSONObject
                val ok = payload?.optBoolean("ok") == true
                if (!ok) {
                    val errorCode = payload?.optString("error") ?: "unknown"
                    val statusMessage = "TypeAgent submit failed: $errorCode"
                    Log.e(TAG, statusMessage)
                    _connectionStatus.value = ConnectionStatus(
                        text = statusMessage,
                        state = ConnectionStatus.State.ERROR
                    )
                    return@sendInvoke
                }

                val requestId = payload
                    ?.optJSONObject("entry")
                    ?.optString("requestId")
                    .orEmpty()

                Log.d(
                    TAG,
                    "submitCommand acknowledged: requestId=$requestId connectionId=${connectionId.orEmpty()} content=$message"
                )
            },
            onError = { error ->
                Log.e(TAG, "submitCommand error: $error")
                _connectionStatus.value = ConnectionStatus(
                    text = "Error: $error",
                    state = ConnectionStatus.State.ERROR
                )
            }
        )
    }

    fun disconnect() {
        webSocket?.close(NORMAL_CLOSURE_STATUS, "App closed")
        webSocket = null
        failPendingInvokes("App closed")
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun joinConversation() {
        val options = JSONObject()
            .put("clientType", "extension")
            .put("filter", false)

        sendInvoke(
            channelName = AGENT_SERVER_CHANNEL,
            methodName = "joinConversation",
            args = listOf(options),
            onResult = { result ->
                val payload = result as? JSONObject
                val joinedConversationId = payload?.optString("conversationId").orEmpty()
                val joinedConnectionId = payload?.optString("connectionId").orEmpty()
                if (joinedConversationId.isBlank() || joinedConnectionId.isBlank()) {
                    val errorMessage = "TypeAgent joinConversation returned an invalid payload."
                    Log.e(TAG, errorMessage)
                    _connectionStatus.value = ConnectionStatus(
                        text = errorMessage,
                        state = ConnectionStatus.State.ERROR
                    )
                    return@sendInvoke
                }

                synchronized(lock) {
                    conversationId = joinedConversationId
                    connectionId = joinedConnectionId
                }

                Log.d(
                    TAG,
                    "TypeAgent conversation joined: connectionId=$joinedConnectionId conversationId=$joinedConversationId"
                )
                _connectionStatus.value = ConnectionStatus(
                    text = "Connected",
                    state = ConnectionStatus.State.CONNECTED
                )
            },
            onError = { error ->
                Log.e(TAG, "joinConversation error: $error")
                _connectionStatus.value = ConnectionStatus(
                    text = "Error: $error",
                    state = ConnectionStatus.State.ERROR
                )
            }
        )
    }

    private fun handleIncomingFrame(text: String) {
        try {
            val payload = JSONObject(text)
            if (payload.has("name") && payload.has("message")) {
                val channelName = payload.optString("name")
                val message = payload.optJSONObject("message") ?: return
                when (message.optString("type")) {
                    "invokeResult" -> handleInvokeResult(message)
                    "invokeError" -> handleInvokeError(message)
                    "call" -> handleRpcCall(channelName, message)
                    "invoke" -> handleRpcInvoke(channelName, message)
                    else -> Log.d(TAG, "Unhandled RPC message type: ${message.optString("type")}")
                }
            } else if (payload.has("type")) {
                handleDisplayLogEvent(payload)
            } else {
                Log.d(TAG, "Unhandled message payload: $text")
            }
        } catch (error: Exception) {
            Log.d(TAG, "Non-JSON message received: $text")
            logInboundEvent(
                type = "raw-text",
                requestId = null,
                content = text
            )
            appendAssistantContent(requestId = null, content = text)
        }
    }

    private fun handleInvokeResult(message: JSONObject) {
        val callId = message.optInt("callId", -1)
        val pending = synchronized(lock) { pendingInvokes.remove(callId) } ?: return
        pending.onResult(message.optNullable("result"))
    }

    private fun handleInvokeError(message: JSONObject) {
        val callId = message.optInt("callId", -1)
        val error = message.optString("error", "Unknown RPC error")
        val pending = synchronized(lock) { pendingInvokes.remove(callId) } ?: return
        pending.onError(error)
    }

    private fun handleRpcCall(channelName: String, message: JSONObject) {
        val methodName = message.optString("name")
        val args = message.optJSONArray("args") ?: JSONArray()
        when {
            channelName.startsWith(CLIENT_IO_CHANNEL_PREFIX) -> handleClientIoCall(methodName, args)
            else -> Log.d(TAG, "Unhandled RPC call channel=$channelName method=$methodName")
        }
    }

    private fun handleRpcInvoke(channelName: String, message: JSONObject) {
        val methodName = message.optString("name")
        val callId = message.optInt("callId", -1)
        val result = when (methodName) {
            "getUserContext" -> JSONObject.NULL
            else -> null
        }

        if (result != null) {
            sendRpcResult(channelName, callId, result)
        } else {
            sendRpcError(channelName, callId, "Unsupported client RPC method: $methodName")
        }
    }

    private fun handleClientIoCall(methodName: String, args: JSONArray) {
        when (methodName) {
            "appendDisplay" -> {
                val requestId = extractRequestId(args.opt(0))
                val content = extractAgentMessageText(args.opt(0))
                val mode = args.optString(1)
                logInboundEvent(
                    type = "append-display",
                    requestId = requestId,
                    content = content
                )
                if (shouldAppendToAssistantBubble(content, mode)) {
                    appendAssistantContent(requestId = requestId, content = content)
                }
            }

            "setDisplayInfo" -> {
                val requestId = extractRequestId(args.opt(0))
                val source = args.optString(1).orEmpty()
                val actionSummary = stringifyValue(args.optNullable(3))
                val content = listOf(source, actionSummary)
                    .filter { it.isNotBlank() && it != "null" }
                    .joinToString(" ")
                logInboundEvent(
                    type = "set-display-info",
                    requestId = requestId,
                    content = content
                )
                if (source.isNotBlank()) {
                    _connectionStatus.value = ConnectionStatus(
                        text = "Connected - $source",
                        state = ConnectionStatus.State.CONNECTED
                    )
                }
            }

            "setDisplay" -> {
                val requestId = extractRequestId(args.opt(0))
                val content = extractAgentMessageText(args.opt(0))
                logInboundEvent(
                    type = "set-display",
                    requestId = requestId,
                    content = content
                )
                replaceAssistantContent(requestId = requestId, content = content)
            }

            "notify" -> {
                val notificationId = args.opt(0)
                val event = args.optString(1)
                val data = args.optNullable(2)
                val requestId = extractRequestId(notificationId)
                val content = stringifyValue(data)
                val normalizedType = if (event == "commandComplete") {
                    "command-result"
                } else {
                    "notify:$event"
                }
                logInboundEvent(
                    type = normalizedType,
                    requestId = requestId,
                    content = content
                )
                if (event == "commandComplete" && requestId != null) {
                    finalizeAssistantMessage(requestId)
                    _connectionStatus.value = ConnectionStatus(
                        text = "Connected",
                        state = ConnectionStatus.State.CONNECTED
                    )
                }
            }

            "requestCancelled" -> {
                val requestId = args.optString(0).orEmpty()
                val reason = args.optString(1).orEmpty()
                logInboundEvent(
                    type = "request-cancelled",
                    requestId = requestId.ifBlank { null },
                    content = reason
                )
                if (requestId.isNotBlank()) {
                    finalizeAssistantMessage(requestId)
                }
            }

            "setUserRequest" -> {
                val requestId = extractRequestId(args.opt(0))
                val content = args.optString(1).orEmpty()
                logInboundEvent(
                    type = "set-user-request",
                    requestId = requestId,
                    content = content
                )
            }

            else -> {
                val requestId = extractRequestId(args.opt(0))
                logInboundEvent(
                    type = methodName,
                    requestId = requestId,
                    content = stringifyValue(args.optNullable(0))
                )
            }
        }
    }

    private fun handleDisplayLogEvent(event: JSONObject) {
        val eventType = event.optString("type")
        when (eventType) {
            "append-display" -> {
                val requestId = extractRequestId(event.opt("requestId")) ?: extractRequestId(event.optJSONObject("message"))
                val content = extractAgentMessageText(event.opt("message"))
                logInboundEvent(eventType, requestId, content)
                appendAssistantContent(requestId, content)
            }

            "set-display-info" -> {
                val requestId = extractRequestId(event.opt("requestId"))
                val content = listOf(
                    event.optString("source"),
                    stringifyValue(event.optNullable("action"))
                ).filter { it.isNotBlank() && it != "null" }
                    .joinToString(" ")
                logInboundEvent(eventType, requestId, content)
                if (event.optString("source").isNotBlank()) {
                    _connectionStatus.value = ConnectionStatus(
                        text = "Connected - ${event.optString("source")}",
                        state = ConnectionStatus.State.CONNECTED
                    )
                }
            }

            "command-result" -> {
                val requestId = extractRequestId(event.opt("requestId"))
                logInboundEvent(eventType, requestId, stringifyValue(event.optNullable("metrics")))
                if (requestId != null) {
                    finalizeAssistantMessage(requestId)
                }
            }

            else -> {
                logInboundEvent(eventType, extractRequestId(event.opt("requestId")), stringifyValue(event))
            }
        }
    }

    private fun appendUserMessage(text: String) {
        synchronized(lock) {
            _messages.value = _messages.value + Message(
                text = text,
                isUser = true
            )
        }
    }

    private fun appendAssistantContent(requestId: String?, content: String) {
        if (content.isBlank()) {
            return
        }

        synchronized(lock) {
            val updated = _messages.value.toMutableList()
            val existingIndex = updated.indexOfLast {
                !it.isUser && it.requestId == requestId && !it.isFinal
            }
            if (existingIndex >= 0) {
                val existing = updated[existingIndex]
                updated[existingIndex] = existing.copy(
                    text = existing.text + content
                )
            } else {
                updated += Message(
                    text = content.trim(),
                    isUser = false,
                    requestId = requestId
                )
            }
            _messages.value = updated
        }
    }

    private fun replaceAssistantContent(requestId: String?, content: String) {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) {
            return
        }

        synchronized(lock) {
            val updated = _messages.value.toMutableList()
            val existingIndex = updated.indexOfLast {
                !it.isUser && it.requestId == requestId && !it.isFinal
            }
            if (existingIndex >= 0) {
                val existing = updated[existingIndex]
                updated[existingIndex] = existing.copy(text = trimmed)
            } else {
                updated += Message(
                    text = trimmed,
                    isUser = false,
                    requestId = requestId
                )
            }
            _messages.value = updated
        }
    }

    private fun finalizeAssistantMessage(requestId: String) {
        synchronized(lock) {
            val updated = _messages.value.toMutableList()
            val existingIndex = updated.indexOfLast {
                !it.isUser && it.requestId == requestId && !it.isFinal
            }
            if (existingIndex >= 0) {
                val existing = updated[existingIndex]
                updated[existingIndex] = existing.copy(isFinal = true)
                _messages.value = updated
            }
        }
    }

    private fun sendInvoke(
        channelName: String,
        methodName: String,
        args: List<Any?>,
        onResult: (Any?) -> Unit,
        onError: (String) -> Unit
    ) {
        val socket = webSocket
        if (socket == null) {
            onError("WebSocket is not connected.")
            return
        }

        val callId = nextCallId.getAndIncrement()
        synchronized(lock) {
            pendingInvokes[callId] = PendingInvoke(onResult, onError)
        }

        val message = JSONObject()
            .put("type", "invoke")
            .put("callId", callId)
            .put("name", methodName)
            .put("args", JSONArray().apply {
                args.forEach { put(it.wrapJsonValue()) }
            })

        val envelope = JSONObject()
            .put("name", channelName)
            .put("message", message)

        if (!socket.send(envelope.toString())) {
            val removed = synchronized(lock) { pendingInvokes.remove(callId) }
            if (removed != null) {
                onError("Failed to send RPC invoke for $methodName.")
            }
        }
    }

    private fun sendRpcResult(channelName: String, callId: Int, result: Any?) {
        val socket = webSocket ?: return
        val message = JSONObject()
            .put("type", "invokeResult")
            .put("callId", callId)
            .put("result", result.wrapJsonValue())
        val envelope = JSONObject()
            .put("name", channelName)
            .put("message", message)
        socket.send(envelope.toString())
    }

    private fun sendRpcError(channelName: String, callId: Int, error: String) {
        val socket = webSocket ?: return
        val message = JSONObject()
            .put("type", "invokeError")
            .put("callId", callId)
            .put("error", error)
        val envelope = JSONObject()
            .put("name", channelName)
            .put("message", message)
        socket.send(envelope.toString())
    }

    private fun failPendingInvokes(reason: String) {
        val pending = synchronized(lock) {
            pendingInvokes.values.toList().also { pendingInvokes.clear() }
        }
        pending.forEach { it.onError(reason) }
    }

    private fun logInboundEvent(type: String, requestId: String?, content: String) {
        Log.d(
            TAG,
            "Inbound event type=$type requestId=${requestId.orEmpty()} connectionId=${connectionId.orEmpty()} content=$content"
        )
    }

    private fun extractAgentMessageText(value: Any?): String {
        val agentMessage = value as? JSONObject ?: return stringifyValue(value)
        val displayContent = agentMessage.optNullable("message")
        return extractDisplayText(displayContent)
    }

    private fun extractDisplayText(value: Any?): String {
        return when (value) {
            null, JSONObject.NULL -> ""
            is String -> value
            is JSONArray -> {
                if (value.length() == 0) {
                    ""
                } else {
                    val parts = mutableListOf<String>()
                    for (index in 0 until value.length()) {
                        parts += extractDisplayText(value.optNullable(index))
                    }
                    parts.joinToString("\n")
                }
            }

            is JSONObject -> {
                val content = value.optNullable("content")
                if (content != null && content != JSONObject.NULL) {
                    extractDisplayText(content)
                } else {
                    val alternates = value.optJSONArray("alternates")
                    if (alternates != null && alternates.length() > 0) {
                        extractDisplayText(alternates.optJSONObject(0)?.optNullable("content"))
                    } else {
                        value.toString()
                    }
                }
            }

            else -> value.toString()
        }
    }

    private fun extractRequestId(value: Any?): String? {
        return when (value) {
            null, JSONObject.NULL -> null
            is String -> value
            is JSONObject -> {
                when {
                    value.has("requestId") -> {
                        val nestedRequestId = value.opt("requestId")
                        when (nestedRequestId) {
                            is String -> nestedRequestId.ifBlank { null }
                            is JSONObject -> extractRequestId(nestedRequestId)
                            else -> nestedRequestId?.toString()?.ifBlank { null }
                        }
                    }
                    value.has("message") -> extractRequestId(value.optJSONObject("message"))
                    else -> null
                }
            }

            else -> null
        }
    }

    private fun stringifyValue(value: Any?): String {
        return when (value) {
            null, JSONObject.NULL -> ""
            is String -> value
            is JSONObject -> value.toString()
            is JSONArray -> value.toString()
            else -> value.toString()
        }
    }

    private fun shouldAppendToAssistantBubble(content: String, mode: String): Boolean {
        if (content.isBlank()) {
            return false
        }
        if (mode == "temporary") {
            return false
        }
        return !content.startsWith("[")
    }

    private fun Any?.wrapJsonValue(): Any {
        return when (this) {
            null -> JSONObject.NULL
            else -> this
        }
    }

    private fun JSONObject.optNullable(name: String): Any? {
        return if (has(name)) opt(name) else null
    }

    private fun JSONArray.optNullable(index: Int): Any? {
        return if (index in 0 until length()) opt(index) else null
    }

    private fun dispatcherChannelName(conversationId: String): String {
        return "dispatcher:$conversationId"
    }

    private data class PendingInvoke(
        val onResult: (Any?) -> Unit,
        val onError: (String) -> Unit
    )

    companion object {
        private const val TAG = "WebSocketManager"
        private const val NORMAL_CLOSURE_STATUS = 1000
        private const val AGENT_SERVER_CHANNEL = "agent-server"
        private const val CLIENT_IO_CHANNEL_PREFIX = "clientio:"
    }
}

data class ConnectionStatus(
    val text: String,
    val state: State
) {
    enum class State {
        CONNECTING,
        CONNECTED,
        DISCONNECTED,
        ERROR
    }
}
