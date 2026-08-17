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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class WebSocketManager {

    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private val lock = Any()
    private val nextCallId = AtomicInteger(0)
    private val connectionGeneration = AtomicInteger(0)
    private val pendingInvokes = mutableMapOf<Int, PendingInvoke>()
    private val displayThreads = mutableMapOf<String, AgentDisplayThread>()
    private val displayMessageIds = mutableMapOf<String, String>()

    @Volatile
    private var webSocket: WebSocket? = null
    private var conversationId: String? = null
    private var connectionId: String? = null
    private var agentSchemaContent: String? = null
    private var isClientAgentRegistered = false
    private var pendingUserInteraction: PendingUserInteraction? = null
    private var clientActionHandler: ClientActionHandler? = null

    /**
     * The conversation this connection asked to resume, if any. Kept separate
     * from [conversationId] so an in-flight resume is never mistaken for a
     * conversation that has actually been joined.
     */
    private var requestedConversationId: String? = null
    private var staleConversationHandler: (() -> Unit)? = null

    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages
    private val _pendingYesNoPrompt = MutableStateFlow<PendingYesNoPrompt?>(null)
    val pendingYesNoPrompt: StateFlow<PendingYesNoPrompt?> = _pendingYesNoPrompt

    /**
     * The conversation the server handed back on the last successful join.
     *
     * Survives a disconnect deliberately: it is persisted alongside the
     * transcript and passed back into the next [connect] so the client resumes
     * the same conversation instead of landing on the server's default one.
     */
    private val _lastJoinedConversationId = MutableStateFlow<String?>(null)
    val lastJoinedConversationId: StateFlow<String?> = _lastJoinedConversationId

    private val _connectionStatus = MutableStateFlow(
        ConnectionStatus(
            text = "Disconnected",
            state = ConnectionStatus.State.DISCONNECTED
        )
    )
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus

    internal fun setClientActionHandler(handler: ClientActionHandler?) {
        synchronized(lock) {
            clientActionHandler = handler
        }
    }

    /**
     * Called when a resume was requested for a conversation the server no
     * longer has. The client fell back to the default conversation, so the
     * restored transcript belongs to nothing and should be discarded.
     */
    internal fun setStaleConversationHandler(handler: (() -> Unit)?) {
        synchronized(lock) {
            staleConversationHandler = handler
        }
    }

    /**
     * Seeds the transcript with messages recovered from disk.
     *
     * Must be called before [connect]; it deliberately refuses once anything is
     * already in the list so a late restore can never clobber live messages.
     */
    fun restoreMessages(restored: List<Message>) {
        if (restored.isEmpty()) {
            return
        }
        synchronized(lock) {
            if (_messages.value.isNotEmpty()) {
                Log.w(TAG, "Ignoring restore: transcript already has messages")
                return
            }
            _messages.value = restored
        }
    }

    /**
     * Drops the local transcript.
     *
     * Used by the client-side "Clear chat" action, and when a resume lands on a
     * conversation the restored transcript does not belong to.
     */
    fun clearMessages() {
        synchronized(lock) {
            displayThreads.clear()
            displayMessageIds.clear()
            _messages.value = emptyList()
        }
    }

    /**
     * @param resumeConversationId the conversation to resume. When present it
     *   is passed straight to `joinConversation`, so the client rejoins the
     *   exact conversation it was last in. When the server no longer has it,
     *   the join falls back to the default conversation and the
     *   stale-conversation handler fires. When absent the server joins (or
     *   creates) the default conversation.
     */
    fun connect(
        url: String,
        tunnelToken: String? = null,
        schemaContent: String? = null,
        resumeConversationId: String? = null
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
        val resolvedSchemaContent = schemaContent
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: synchronized(lock) { agentSchemaContent }
        if (resolvedSchemaContent.isNullOrBlank()) {
            val errorMessage = "The Android alarm and timer schema is unavailable."
            Log.e(TAG, errorMessage)
            _connectionStatus.value = ConnectionStatus(
                text = errorMessage,
                state = ConnectionStatus.State.ERROR
            )
            return
        }

        // Claim the new generation before touching anything else. Everything
        // below invalidates the previous connection, so its in-flight callbacks
        // have to be able to see that they have been superseded; bumping the
        // generation afterwards leaves a window in which one of them still
        // believes it is current and writes over the connection replacing it.
        val generation = connectionGeneration.incrementAndGet()

        synchronized(lock) {
            pendingInvokes.clear()
            pendingUserInteraction = null
            conversationId = null
            connectionId = null
            requestedConversationId = resumeConversationId?.takeIf { it.isNotBlank() }
            agentSchemaContent = resolvedSchemaContent
            isClientAgentRegistered = false
            displayThreads.clear()
            displayMessageIds.clear()
        }
        _pendingYesNoPrompt.value = null
        webSocket?.cancel()
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
                joinConversation(synchronized(lock) { requestedConversationId })
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
                    pendingUserInteraction = null
                    conversationId = null
                    connectionId = null
                    isClientAgentRegistered = false
                    finalizeOpenDisplayThreads()
                }
                _pendingYesNoPrompt.value = null
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
                synchronized(lock) {
                    pendingUserInteraction = null
                    isClientAgentRegistered = false
                    finalizeOpenDisplayThreads()
                }
                _pendingYesNoPrompt.value = null
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
        if (tryHandlePendingInteractionResponse(message, currentConversationId)) {
            return
        }

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
                    "submitCommand acknowledged: requestId=$requestId connectionId=${connectionId.orEmpty()}"
                )
            },
            onError = { error ->
                synchronized(lock) {
                    pendingUserInteraction = null
                }
                _pendingYesNoPrompt.value = null
                Log.e(TAG, "submitCommand error: $error")
                _connectionStatus.value = ConnectionStatus(
                    text = "Error: $error",
                    state = ConnectionStatus.State.ERROR
                )
            }
        )
    }

    fun disconnect() {
        // Retires this connection first, so the callbacks that the teardown
        // below is about to fail cannot report a registration failure over the
        // final state.
        connectionGeneration.incrementAndGet()
        webSocket?.close(NORMAL_CLOSURE_STATUS, "App closed")
        webSocket = null
        synchronized(lock) {
            pendingUserInteraction = null
            isClientAgentRegistered = false
            finalizeOpenDisplayThreads()
        }
        _pendingYesNoPrompt.value = null
        failPendingInvokes("App closed")
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    fun respondToPendingYesNo(yes: Boolean): Boolean {
        val currentConversationId = synchronized(lock) { conversationId } ?: return false
        val pending = synchronized(lock) { pendingUserInteraction } ?: return false
        if (!pending.expectsBooleanReply) {
            return false
        }

        val submission = when (pending) {
            is PendingUserInteraction.Choice -> InteractionSubmission.Choice(payload = yes)
            is PendingUserInteraction.Interaction -> {
                val index = if (yes) {
                    pending.choices.indexOfFirst { it.equals("Yes", ignoreCase = true) }
                } else {
                    pending.choices.indexOfFirst { it.equals("No", ignoreCase = true) }
                }
                if (index !in pending.choices.indices) {
                    return false
                }
                val response = JSONObject()
                    .put("interactionId", pending.interactionId)
                    .put("type", "question")
                    .put("value", index)
                InteractionSubmission.Interaction(response = response)
            }
        }

        synchronized(lock) {
            pendingUserInteraction = null
        }
        _pendingYesNoPrompt.value = null
        submitInteractionSubmission(
            currentConversationId = currentConversationId,
            pending = pending,
            response = submission
        )
        return true
    }

    /**
     * Joins [resumeConversationId] when supplied, otherwise the server's
     * default conversation (which it creates if none exists).
     *
     * If the requested conversation is gone the server answers
     * "Conversation not found", and this retries once against the default. The
     * retry passes `null`, so it cannot recurse.
     */
    private fun joinConversation(resumeConversationId: String?) {
        val options = JSONObject()
            .put("clientType", "extension")
            .put("filter", false)
            .putOpt("conversationId", resumeConversationId)

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
                    requestedConversationId = null
                }
                _lastJoinedConversationId.value = joinedConversationId

                Log.d(
                    TAG,
                    "TypeAgent conversation joined: connectionId=$joinedConnectionId conversationId=$joinedConversationId"
                )
                registerClientAgent(joinedConversationId)
            },
            onError = { error ->
                Log.e(TAG, "joinConversation error: $error")
                if (resumeConversationId != null && isConversationNotFoundError(error)) {
                    // The saved conversation is gone (server data wiped,
                    // deleted elsewhere). Fall back to the default conversation
                    // and tell the client its restored transcript is orphaned.
                    Log.w(
                        TAG,
                        "Conversation $resumeConversationId no longer exists; joining the default"
                    )
                    // Read the handler under the lock but invoke it outside, so
                    // a client callback can never re-enter and deadlock.
                    val onStale = synchronized(lock) {
                        requestedConversationId = null
                        staleConversationHandler
                    }
                    // Drop the dead id before handing control to the client.
                    // It is still the "last joined" one, so a debounced save or
                    // a teardown flush landing while the fallback join is in
                    // flight would write the deleted conversation back to disk,
                    // and a reconnect in that window would try to resume it.
                    _lastJoinedConversationId.value = null
                    onStale?.invoke()
                    joinConversation(null)
                    return@sendInvoke
                }
                _connectionStatus.value = ConnectionStatus(
                    text = "Error: $error",
                    state = ConnectionStatus.State.ERROR
                )
            }
        )
    }

    /** Registers this client as the `androidDevice` agent for the conversation. */
    private fun registerClientAgent(joinedConversationId: String) {
        val schemaContent = synchronized(lock) { agentSchemaContent }
        if (schemaContent.isNullOrBlank()) {
            val errorMessage = "The Android alarm and timer schema is unavailable."
            Log.e(TAG, errorMessage)
            _connectionStatus.value = ConnectionStatus(
                text = errorMessage,
                state = ConnectionStatus.State.ERROR
            )
            return
        }

        // Registration outlives the invoke that starts it, so a reconnect can
        // supersede this connection while the call is in flight. Both callbacks
        // check the generation before touching shared state, exactly as the
        // socket callbacks do: a late result must not report a dead
        // connection's agent as registered on top of the new one.
        val generation = connectionGeneration.get()
        _connectionStatus.value = ConnectionStatus(
            text = "Registering Android actions...",
            state = ConnectionStatus.State.CONNECTING
        )
        sendInvoke(
            channelName = AGENT_SERVER_CHANNEL,
            methodName = "registerClientAgent",
            args = listOf(
                AndroidDeviceAgent.createRegistrationParams(
                    conversationId = joinedConversationId,
                    schemaContent = schemaContent
                )
            ),
            onResult = {
                if (isSupersededConnection(generation, "registerClientAgent result")) {
                    return@sendInvoke
                }
                markClientAgentRegistered(
                    logMessage = "Registered client agent ${AndroidDeviceAgent.NAME} " +
                        "for conversation $joinedConversationId",
                    statusText = STATUS_AGENT_REGISTERED,
                    isRecovery = false
                )
            },
            onError = { error ->
                if (isSupersededConnection(generation, "registerClientAgent error: $error")) {
                    return@sendInvoke
                }
                if (isAgentAlreadyRegisteredError(error, AndroidDeviceAgent.NAME)) {
                    handleRegistrationCollision(joinedConversationId)
                    return@sendInvoke
                }
                synchronized(lock) {
                    isClientAgentRegistered = false
                }
                Log.e(TAG, "registerClientAgent error: $error")
                _connectionStatus.value = ConnectionStatus(
                    text = "Agent registration failed: $error",
                    state = ConnectionStatus.State.ERROR
                )
            }
        )
    }

    /**
     * Handles the server rejecting a registration because `androidDevice` is
     * already registered for this conversation.
     *
     * The registration is accepted as it stands rather than retried. The cause
     * is a registration that outlived its socket, and the server only drops
     * those when its own keepalive gives up on the dead connection - tens of
     * seconds at least, so no delay short enough to sit inside a connect is
     * worth waiting. Claiming the agent is registered is still better than the
     * alternative, which is refusing every action until the app is restarted.
     *
     * It gets its own status text because the guarantee is weaker: the app is
     * trusting a registration it did not make, and until the server drops the
     * old connection it may keep routing invokes there, in which case actions
     * silently do nothing. That must not look like a clean registration.
     */
    private fun handleRegistrationCollision(joinedConversationId: String) {
        markClientAgentRegistered(
            logMessage = "Client agent ${AndroidDeviceAgent.NAME} is already registered for " +
                "conversation $joinedConversationId; reusing that registration. Actions will " +
                "do nothing until the server drops the connection it was registered on.",
            statusText = STATUS_AGENT_REGISTRATION_REUSED,
            isRecovery = true
        )
    }

    private fun markClientAgentRegistered(
        logMessage: String,
        statusText: String,
        isRecovery: Boolean
    ) {
        synchronized(lock) {
            isClientAgentRegistered = true
        }
        if (isRecovery) Log.w(TAG, logMessage) else Log.d(TAG, logMessage)
        _connectionStatus.value = ConnectionStatus(
            text = statusText,
            state = ConnectionStatus.State.CONNECTED
        )
    }

    /**
     * True when a newer [connect] has replaced the connection [generation]
     * belonged to, so its late callbacks must be dropped rather than applied to
     * the connection that took its place.
     */
    private fun isSupersededConnection(generation: Int, what: String): Boolean {
        if (connectionGeneration.get() == generation) {
            return false
        }
        Log.d(TAG, "Ignoring $what from superseded connection generation $generation")
        return true
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
            Log.e(
                TAG,
                "Failed to parse inbound frame as JSON; treating as raw text. length=${text.length}",
                error
            )
            logInboundEvent(
                type = "raw-text",
                requestId = null,
                content = text
            )
            applyDisplay(
                requestId = null,
                content = ParsedDisplayContent(text = text, format = MessageFormat.TEXT),
                // STEP seals the bubble immediately. Without it every
                // unparseable frame in the session would accumulate into the
                // same no-requestId bubble, which would never be finalized and
                // would show "Responding..." forever.
                mode = DisplayAppendMode.STEP
            )
        }
    }

    private fun handleInvokeResult(message: JSONObject) {
        val callId = message.optInt("callId", -1)
        Log.d(TAG, "RPC invokeResult callId=$callId")
        val pending = synchronized(lock) { pendingInvokes.remove(callId) } ?: return
        pending.onResult(message.optNullable("result"))
    }

    private fun handleInvokeError(message: JSONObject) {
        val callId = message.optInt("callId", -1)
        val error = message.optString("error", "Unknown RPC error")
        Log.e(TAG, "RPC invokeError callId=$callId error=$error")
        val pending = synchronized(lock) { pendingInvokes.remove(callId) } ?: return
        pending.onError(error)
    }

    private fun handleRpcCall(channelName: String, message: JSONObject) {
        val methodName = message.optString("name")
        val args = message.optJSONArray("args") ?: JSONArray()
        Log.d(
            TAG,
            "RPC call channel=$channelName method=$methodName argCount=${args.length()}"
        )
        when {
            channelName.startsWith(CLIENT_IO_CHANNEL_PREFIX) -> handleClientIoCall(methodName, args)
            else -> Log.d(TAG, "Unhandled RPC call channel=$channelName method=$methodName")
        }
    }

    private fun handleRpcInvoke(channelName: String, message: JSONObject) {
        val methodName = message.optString("name")
        val callId = message.optInt("callId", -1)
        val args = message.optJSONArray("args") ?: JSONArray()
        Log.d(
            TAG,
            "RPC invoke channel=$channelName method=$methodName callId=$callId argCount=${args.length()}"
        )
        if (channelName == AndroidDeviceAgent.CHANNEL_NAME) {
            handleAndroidDeviceInvoke(
                channelName = channelName,
                methodName = methodName,
                callId = callId,
                args = args
            )
            return
        }

        val result = when (methodName) {
            "getUserContext" -> JSONObject.NULL
            "question" -> handleQuestionInvoke(args)
            else -> null
        }

        if (result != null) {
            sendRpcResult(channelName, callId, result)
        } else {
            sendRpcError(channelName, callId, "Unsupported client RPC method: $methodName")
        }
    }

    private fun handleAndroidDeviceInvoke(
        channelName: String,
        methodName: String,
        callId: Int,
        args: JSONArray
    ) {
        if (callId < 0) {
            Log.e(TAG, "Android agent invocation is missing callId.")
            return
        }
        if (methodName != "executeAction") {
            sendRpcError(
                channelName,
                callId,
                "Unsupported Android agent RPC method: $methodName"
            )
            return
        }
        if (!synchronized(lock) { isClientAgentRegistered }) {
            sendRpcError(channelName, callId, "Android client agent is not registered.")
            return
        }

        when (val parsed = AndroidDeviceAgent.parseExecuteAction(args)) {
            is AndroidDeviceActionParseResult.ProtocolError -> {
                sendRpcError(channelName, callId, parsed.message)
            }

            is AndroidDeviceActionParseResult.ActionError -> {
                sendRpcResult(
                    channelName,
                    callId,
                    AndroidDeviceAgent.createErrorResult(parsed.message)
                )
            }

            is AndroidDeviceActionParseResult.Success -> {
                executeAndroidDeviceAction(
                    channelName = channelName,
                    callId = callId,
                    action = parsed.action
                )
            }
        }
    }

    private fun executeAndroidDeviceAction(
        channelName: String,
        callId: Int,
        action: AndroidDeviceAction
    ) {
        val handler = synchronized(lock) { clientActionHandler }
        if (handler == null) {
            sendRpcResult(
                channelName,
                callId,
                AndroidDeviceAgent.createErrorResult(
                    "The Android activity is not ready to execute actions."
                )
            )
            return
        }

        val completed = AtomicBoolean(false)
        val generation = connectionGeneration.get()
        val completion: (AndroidDeviceExecutionResult) -> Unit = { result ->
            if (!completed.compareAndSet(false, true)) {
                Log.w(TAG, "Ignoring duplicate completion for agent callId=$callId")
            } else if (connectionGeneration.get() != generation) {
                Log.w(TAG, "Ignoring completion for stale agent callId=$callId")
            } else {
                val actionResult = when (result) {
                    is AndroidDeviceExecutionResult.Success ->
                        AndroidDeviceAgent.createSuccessResult(result.message)
                    is AndroidDeviceExecutionResult.Failure ->
                        AndroidDeviceAgent.createErrorResult(result.message)
                }
                sendRpcResult(channelName, callId, actionResult)
            }
        }

        when (action) {
            is AndroidDeviceAction.Alarm -> handler.onSetAlarm(action.action, completion)
            is AndroidDeviceAction.Timer -> handler.onSetTimer(action.action, completion)
            is AndroidDeviceAction.SearchNearby ->
                handler.onSearchNearby(action.action, completion)
            AndroidDeviceAction.ShowAlarms -> handler.onShowAlarms(completion)
            AndroidDeviceAction.ShowTimers -> handler.onShowTimers(completion)
            is AndroidDeviceAction.ShowLocation ->
                handler.onShowLocation(action.action, completion)
            is AndroidDeviceAction.DialPhoneNumber ->
                handler.onDialPhoneNumber(action.action, completion)
            is AndroidDeviceAction.ComposeSms ->
                handler.onComposeSms(action.action, completion)
            is AndroidDeviceAction.WebSearch ->
                handler.onWebSearch(action.action, completion)
            is AndroidDeviceAction.OpenWebPage ->
                handler.onOpenWebPage(action.action, completion)
        }
    }

    private fun handleClientIoCall(methodName: String, args: JSONArray) {
        when (methodName) {
            "appendDisplay" -> {
                val requestId = extractRequestId(args.opt(0))
                val kind = extractAgentMessageKind(args.opt(0))
                val content = extractAgentMessageContent(args.opt(0))
                val mode = parseDisplayAppendMode(args.optString(1))
                logInboundEvent(
                    type = "append-display",
                    requestId = requestId,
                    content = content.text,
                    detail = "mode=$mode kind=${kind.orEmpty()}"
                )
                if (!isEphemeralAgentMessageKind(kind)) {
                    applyDisplay(requestId = requestId, content = content, mode = mode)
                }
            }

            "setDisplayInfo" -> {
                val requestId = extractRequestId(args.opt(0))
                val source = args.optString(1).orEmpty()
                val actionSummary = stringifyDisplayValue(args.optNullable(3))
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
                val kind = extractAgentMessageKind(args.opt(0))
                val content = extractAgentMessageContent(args.opt(0))
                logInboundEvent(
                    type = "set-display",
                    requestId = requestId,
                    content = content.text,
                    detail = "kind=${kind.orEmpty()}"
                )
                if (!isEphemeralAgentMessageKind(kind)) {
                    applyDisplay(
                        requestId = requestId,
                        content = content,
                        mode = DisplayAppendMode.REPLACE
                    )
                }
            }

            "notify" -> {
                val notificationId = args.opt(0)
                val event = args.optString(1)
                val data = args.optNullable(2)
                val requestId = extractRequestId(notificationId)
                val content = stringifyDisplayValue(data)
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
                if (event == "commandComplete") {
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

            "requestChoice" -> {
                handleRequestChoiceCall(args)
            }

            "requestInteraction" -> {
                handleRequestInteractionCall(args)
            }

            "interactionResolved", "interactionCancelled" -> {
                val interactionId = args.optString(0).orEmpty()
                val pending = synchronized(lock) { pendingUserInteraction }
                if (pending is PendingUserInteraction.Interaction && pending.interactionId == interactionId) {
                    synchronized(lock) {
                        pendingUserInteraction = null
                    }
                    _pendingYesNoPrompt.value = null
                }
            }

            else -> {
                val requestId = extractRequestId(args.opt(0))
                logInboundEvent(
                    type = methodName,
                    requestId = requestId,
                    content = stringifyDisplayValue(args.optNullable(0))
                )
            }
        }
    }

    private fun handleDisplayLogEvent(event: JSONObject) {
        val eventType = event.optString("type")
        when (eventType) {
            "append-display" -> {
                val requestId = extractRequestId(event.opt("requestId")) ?: extractRequestId(event.optJSONObject("message"))
                val kind = extractAgentMessageKind(event.opt("message"))
                val content = extractAgentMessageContent(event.opt("message"))
                val mode = parseDisplayAppendMode(event.optString("mode"))
                logInboundEvent(eventType, requestId, content.text, "mode=$mode")
                if (!isEphemeralAgentMessageKind(kind)) {
                    applyDisplay(requestId, content, mode)
                }
            }

            "set-display" -> {
                val requestId = extractRequestId(event.opt("requestId")) ?: extractRequestId(event.optJSONObject("message"))
                val kind = extractAgentMessageKind(event.opt("message"))
                val content = extractAgentMessageContent(event.opt("message"))
                logInboundEvent(eventType, requestId, content.text)
                if (!isEphemeralAgentMessageKind(kind)) {
                    applyDisplay(requestId, content, DisplayAppendMode.REPLACE)
                }
            }

            "set-display-info" -> {
                val requestId = extractRequestId(event.opt("requestId"))
                val content = listOf(
                    event.optString("source"),
                    stringifyDisplayValue(event.optNullable("action"))
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
                logInboundEvent(eventType, requestId, stringifyDisplayValue(event.optNullable("metrics")))
                finalizeAssistantMessage(requestId)
            }

            else -> {
                logInboundEvent(eventType, extractRequestId(event.opt("requestId")), stringifyDisplayValue(event))
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

    /**
     * Port of the shell's `ChatPanel.addAgentMessage` / `replaceAgentMessage`:
     * all display content for one request accumulates in a single bubble, and a
     * trailing `temporary` status chunk is discarded as soon as the next update
     * arrives.
     */
    private fun applyDisplay(
        requestId: String?,
        content: ParsedDisplayContent,
        mode: DisplayAppendMode
    ) {
        synchronized(lock) {
            val key = threadKey(requestId)
            val thread = displayThreads.getOrPut(key) { AgentDisplayThread() }
            thread.setMessage(content, mode)
            syncThreadMessage(key, requestId, thread)
            if (mode == DisplayAppendMode.STEP) {
                commitThread(key, requestId, thread)
            }
        }
    }

    private fun threadKey(requestId: String?): String {
        return requestId ?: DEFAULT_THREAD_KEY
    }

    private fun syncThreadMessage(
        key: String,
        requestId: String?,
        thread: AgentDisplayThread
    ) {
        val rendered = thread.render()
        val updated = _messages.value.toMutableList()
        val messageId = displayMessageIds[key]
        val index = if (messageId == null) -1 else updated.indexOfFirst { it.id == messageId }

        if (index >= 0) {
            if (rendered.isEmpty) {
                updated.removeAt(index)
                displayMessageIds.remove(key)
            } else {
                updated[index] = updated[index].copy(segments = rendered.segments)
            }
        } else {
            if (rendered.isEmpty) {
                return
            }
            val message = Message(
                segments = rendered.segments,
                isUser = false,
                requestId = requestId
            )
            displayMessageIds[key] = message.id
            updated += message
        }
        _messages.value = updated
    }

    /**
     * Equivalent of the shell's `completeRequest`: drop any lingering temporary
     * status text, seal the bubble, and forget the thread so the next display
     * update starts a fresh bubble.
     */
    private fun commitThread(
        key: String,
        requestId: String?,
        thread: AgentDisplayThread
    ) {
        thread.flushTemporary()
        syncThreadMessage(key, requestId, thread)
        displayThreads.remove(key)
        val messageId = displayMessageIds.remove(key) ?: return
        val updated = _messages.value.toMutableList()
        val index = updated.indexOfFirst { it.id == messageId }
        if (index >= 0) {
            updated[index] = updated[index].copy(isFinal = true)
            _messages.value = updated
        }
    }

    /**
     * Seals every bubble that still has an open display thread. Used when the
     * socket goes away mid-request so a bubble is not stranded showing
     * "Responding..." forever, and so the per-request state is not retained
     * across a reconnect.
     */
    private fun finalizeOpenDisplayThreads() {
        for (key in displayThreads.keys.toList()) {
            val thread = displayThreads[key] ?: continue
            val requestId = if (key == DEFAULT_THREAD_KEY) null else key
            commitThread(key, requestId, thread)
        }
        displayThreads.clear()
        displayMessageIds.clear()
    }

    private fun finalizeAssistantMessage(requestId: String?) {
        synchronized(lock) {
            val key = threadKey(requestId)
            val thread = displayThreads[key]
            if (thread != null) {
                commitThread(key, requestId, thread)
                return
            }

            val updated = _messages.value.toMutableList()
            val existingIndex = if (requestId == null) {
                updated.indexOfLast { !it.isUser && !it.isFinal }
            } else {
                updated.indexOfLast {
                    !it.isUser && it.requestId == requestId && !it.isFinal
                }
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

        Log.d(
            TAG,
            "RPC send invoke channel=$channelName method=$methodName callId=$callId"
        )
        if (!socket.send(envelope.toString())) {
            synchronized(lock) {
                pendingInvokes.remove(callId)
            }
            onError("Failed to send RPC invoke for $methodName.")
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
        val sent = socket.send(envelope.toString())
        Log.d(
            TAG,
            "RPC send invokeResult channel=$channelName callId=$callId sent=$sent"
        )
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
        val sent = socket.send(envelope.toString())
        Log.e(
            TAG,
            "RPC send invokeError channel=$channelName callId=$callId sent=$sent error=$error"
        )
    }

    private fun failPendingInvokes(reason: String) {
        val pending = synchronized(lock) {
            pendingInvokes.values.toList().also { pendingInvokes.clear() }
        }
        pending.forEach { it.onError(reason) }
    }

    private fun logInboundEvent(
        type: String,
        requestId: String?,
        content: String,
        detail: String? = null
    ) {
        Log.d(
            TAG,
            "Inbound event type=$type requestId=${requestId.orEmpty()} connectionId=${connectionId.orEmpty()} contentLength=${content.length}${detail?.let { " $it" }.orEmpty()}"
        )
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

    private fun handleRequestChoiceCall(args: JSONArray) {
        val requestId = extractRequestId(args.opt(0))
        val choiceId = args.optString(1).orEmpty()
        val choiceType = args.optString(2).orEmpty()
        val prompt = args.optString(3).orEmpty()
        val choicesArray = args.optJSONArray(4) ?: JSONArray()
        val choices = buildList {
            for (index in 0 until choicesArray.length()) {
                val choice = choicesArray.optString(index).orEmpty()
                if (choice.isNotBlank()) {
                    add(choice)
                }
            }
        }
        logInboundEvent(
            type = "request-choice",
            requestId = requestId,
            content = "choiceType=$choiceType choices=${choices.size}"
        )

        if (choiceId.isBlank()) {
            return
        }

        synchronized(lock) {
            pendingUserInteraction = PendingUserInteraction.Choice(
                requestId = requestId,
                prompt = prompt,
                choiceId = choiceId,
                choiceType = choiceType,
                choices = choices
            )
        }
        appendInteractionPrompt(
            requestId = requestId,
            prompt = prompt,
            choices = choices,
            expectsBoolean = choiceType.equals("yesNo", ignoreCase = true)
        )
        _pendingYesNoPrompt.value = if (choiceType.equals("yesNo", ignoreCase = true)) {
            PendingYesNoPrompt(
                requestId = requestId,
                prompt = prompt.ifBlank { "Please confirm this action." }
            )
        } else {
            null
        }
    }

    private fun handleRequestInteractionCall(args: JSONArray) {
        val interaction = args.optJSONObject(0) ?: return
        val interactionType = interaction.optString("type").orEmpty()
        val interactionId = interaction.optString("interactionId").orEmpty()
        val prompt = interaction.optString("message").orEmpty()
        val requestId = extractRequestId(interaction.opt("requestId"))

        logInboundEvent(
            type = "request-interaction",
            requestId = requestId,
            content = interaction.toString()
        )

        if (!interactionType.equals("question", ignoreCase = true) || interactionId.isBlank()) {
            return
        }

        val choicesArray = interaction.optJSONArray("choices") ?: JSONArray()
        val choices = buildList {
            for (index in 0 until choicesArray.length()) {
                val choice = choicesArray.optString(index).orEmpty()
                if (choice.isNotBlank()) {
                    add(choice)
                }
            }
        }
        synchronized(lock) {
            pendingUserInteraction = PendingUserInteraction.Interaction(
                requestId = requestId,
                prompt = prompt,
                interactionId = interactionId,
                choices = choices
            )
        }
        appendInteractionPrompt(
            requestId = requestId,
            prompt = prompt,
            choices = choices,
            expectsBoolean = choices.size == 2 &&
                choices.any { it.equals("Yes", ignoreCase = true) } &&
                choices.any { it.equals("No", ignoreCase = true) }
        )
        _pendingYesNoPrompt.value = if (
            choices.size == 2 &&
            choices.any { it.equals("Yes", ignoreCase = true) } &&
            choices.any { it.equals("No", ignoreCase = true) }
        ) {
            PendingYesNoPrompt(
                requestId = requestId,
                prompt = prompt.ifBlank { "Please confirm this action." }
            )
        } else {
            null
        }
    }

    private fun handleQuestionInvoke(args: JSONArray): Int {
        val requestId = extractRequestId(args.opt(0))
        val choicesArray = args.optJSONArray(2) ?: JSONArray()
        val choices = buildList {
            for (index in 0 until choicesArray.length()) {
                val choice = choicesArray.optString(index).orEmpty()
                if (choice.isNotBlank()) {
                    add(choice)
                }
            }
        }
        val defaultIndex = args.optInt(3, 0)
        Log.d(
            TAG,
            "ClientIO.question requestId=${requestId.orEmpty()} defaultIndex=$defaultIndex"
        )

        if (choices.isEmpty()) {
            return 0
        }
        return defaultIndex.coerceIn(0, choices.lastIndex)
    }

    private fun tryHandlePendingInteractionResponse(message: String, currentConversationId: String): Boolean {
        val pending = synchronized(lock) { pendingUserInteraction } ?: return false
        val response = when (pending) {
            is PendingUserInteraction.Choice -> parsePendingChoiceResponse(pending, message)
            is PendingUserInteraction.Interaction -> parsePendingInteractionResponse(pending, message)
        } ?: run {
            appendInteractionPrompt(
                requestId = pending.requestId,
                prompt = pending.prompt,
                choices = pending.choices,
                expectsBoolean = pending.expectsBooleanReply
            )
            return true
        }

        synchronized(lock) {
            pendingUserInteraction = null
        }
        _pendingYesNoPrompt.value = null
        submitInteractionSubmission(
            currentConversationId = currentConversationId,
            pending = pending,
            response = response
        )
        return true
    }

    private fun submitInteractionSubmission(
        currentConversationId: String,
        pending: PendingUserInteraction,
        response: InteractionSubmission
    ) {
        when (response) {
            is InteractionSubmission.Choice -> {
                val choice = pending as? PendingUserInteraction.Choice ?: return
                sendInvoke(
                    channelName = dispatcherChannelName(currentConversationId),
                    methodName = "respondToChoice",
                    args = listOf(choice.choiceId, response.payload),
                    onResult = {
                        Log.d(TAG, "respondToChoice completed")
                    },
                    onError = { error ->
                        Log.e(TAG, "respondToChoice error: $error")
                        synchronized(lock) {
                            pendingUserInteraction = pending
                        }
                        if (pending.expectsBooleanReply) {
                            _pendingYesNoPrompt.value = PendingYesNoPrompt(
                                requestId = pending.requestId,
                                prompt = pending.prompt.ifBlank { "Please confirm this action." }
                            )
                        }
                        _connectionStatus.value = ConnectionStatus(
                            text = "Error: $error",
                            state = ConnectionStatus.State.ERROR
                        )
                    }
                )
            }

            is InteractionSubmission.Interaction -> {
                sendInvoke(
                    channelName = dispatcherChannelName(currentConversationId),
                    methodName = "respondToInteraction",
                    args = listOf(response.response),
                    onResult = {
                        Log.d(TAG, "respondToInteraction completed")
                    },
                    onError = { error ->
                        Log.e(TAG, "respondToInteraction error: $error")
                        synchronized(lock) {
                            pendingUserInteraction = pending
                        }
                        if (pending.expectsBooleanReply) {
                            _pendingYesNoPrompt.value = PendingYesNoPrompt(
                                requestId = pending.requestId,
                                prompt = pending.prompt.ifBlank { "Please confirm this action." }
                            )
                        }
                        _connectionStatus.value = ConnectionStatus(
                            text = "Error: $error",
                            state = ConnectionStatus.State.ERROR
                        )
                    }
                )
            }
        }
    }

    private fun parsePendingChoiceResponse(
        pending: PendingUserInteraction.Choice,
        message: String
    ): InteractionSubmission? {
        return when (pending.choiceType.lowercase()) {
            "yesno" -> {
                val parsed = parseYesNoInput(message) ?: return null
                InteractionSubmission.Choice(payload = parsed)
            }
            "multichoice" -> {
                val index = parseSingleChoiceIndex(message, pending.choices.size) ?: return null
                InteractionSubmission.Choice(payload = listOf(index))
            }
            "pickremember" -> {
                val tokens = message.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
                if (tokens.isEmpty()) {
                    return null
                }
                val index = parseSingleChoiceIndex(tokens.first(), pending.choices.size) ?: return null
                val remember = tokens.drop(1).any { it.equals("remember", ignoreCase = true) }
                val payload = JSONObject()
                    .put("selected", index)
                    .put("remember", remember)
                InteractionSubmission.Choice(payload = payload)
            }
            else -> null
        }
    }

    private fun parsePendingInteractionResponse(
        pending: PendingUserInteraction.Interaction,
        message: String
    ): InteractionSubmission? {
        val yesNo = parseYesNoInput(message)
        val index = when {
            yesNo != null -> {
                if (yesNo) {
                    pending.choices.indexOfFirst { it.equals("Yes", ignoreCase = true) }
                } else {
                    pending.choices.indexOfFirst { it.equals("No", ignoreCase = true) }
                }
            }
            else -> parseSingleChoiceIndex(message, pending.choices.size)
        } ?: return null
        if (index !in pending.choices.indices) {
            return null
        }
        val response = JSONObject()
            .put("interactionId", pending.interactionId)
            .put("type", "question")
            .put("value", index)
        return InteractionSubmission.Interaction(response = response)
    }

    private fun appendInteractionPrompt(
        requestId: String?,
        prompt: String,
        choices: List<String>,
        expectsBoolean: Boolean
    ) {
        val displayPrompt = prompt.ifBlank { "Please choose an option." }
        val instructions = when {
            choices.isEmpty() -> "Reply with your response."
            expectsBoolean -> "Type Y to confirm or N to cancel, or use the Yes/No buttons."
            else -> {
                val choiceLines = choices.mapIndexed { index, choice -> "${index + 1}. $choice" }
                "${choiceLines.joinToString("\n")}\nType the option number."
            }
        }
        applyDisplay(
            requestId = requestId,
            content = ParsedDisplayContent(
                text = "$displayPrompt\n$instructions",
                format = MessageFormat.TEXT
            ),
            mode = DisplayAppendMode.BLOCK
        )
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

    private sealed interface PendingUserInteraction {
        val requestId: String?
        val prompt: String
        val choices: List<String>
        val expectsBooleanReply: Boolean

        data class Choice(
            override val requestId: String?,
            override val prompt: String,
            val choiceId: String,
            val choiceType: String,
            override val choices: List<String>
        ) : PendingUserInteraction {
            override val expectsBooleanReply: Boolean =
                choiceType.equals("yesNo", ignoreCase = true)
        }

        data class Interaction(
            override val requestId: String?,
            override val prompt: String,
            val interactionId: String,
            override val choices: List<String>
        ) : PendingUserInteraction {
            override val expectsBooleanReply: Boolean =
                choices.size == 2 &&
                    choices.any { it.equals("Yes", ignoreCase = true) } &&
                    choices.any { it.equals("No", ignoreCase = true) }
        }
    }

    private sealed interface InteractionSubmission {
        data class Choice(val payload: Any) : InteractionSubmission
        data class Interaction(val response: JSONObject) : InteractionSubmission
    }

    companion object {
        private const val TAG = "WebSocketManager"
        private const val NORMAL_CLOSURE_STATUS = 1000
        private const val AGENT_SERVER_CHANNEL = "agent-server"
        private const val CLIENT_IO_CHANNEL_PREFIX = "clientio:"
        private const val DEFAULT_THREAD_KEY = "__no_request__"

        internal const val STATUS_AGENT_REGISTERED = "Connected - Android actions registered"

        /**
         * Deliberately distinct from [STATUS_AGENT_REGISTERED]: the app is
         * reusing a registration it did not make, which is a weaker guarantee.
         */
        internal const val STATUS_AGENT_REGISTRATION_REUSED =
            "Connected - reusing existing Android registration"
    }

    internal interface ClientActionHandler {
        fun onSetAlarm(
            action: SetAlarmAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onSetTimer(
            action: SetTimerAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onSearchNearby(
            action: SearchNearbyAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onShowAlarms(completion: (AndroidDeviceExecutionResult) -> Unit)

        fun onShowTimers(completion: (AndroidDeviceExecutionResult) -> Unit)

        fun onShowLocation(
            action: ShowLocationAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onDialPhoneNumber(
            action: DialPhoneNumberAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onComposeSms(
            action: ComposeSmsAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onWebSearch(
            action: WebSearchAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )

        fun onOpenWebPage(
            action: OpenWebPageAction,
            completion: (AndroidDeviceExecutionResult) -> Unit
        )
    }
}

/**
 * Recognises the server's "Conversation not found" join failure so a resume of
 * a conversation that no longer exists can fall back to the default one,
 * instead of being surfaced as a connection error like a transport or auth
 * failure would be.
 *
 * Mirrors `isConversationNotFoundError` in the agentServer TypeScript client.
 */
internal fun isConversationNotFoundError(error: String?): Boolean =
    error?.trimStart()?.startsWith("Conversation not found", ignoreCase = true) == true

/**
 * True when registerClientAgent was rejected because the agent is already
 * registered for the conversation being joined.
 *
 * The server keys client agents by conversation rather than by connection, and
 * it does not always drop the registration when a socket dies abruptly. A
 * reconnect that resumes the same conversation then collides with the orphaned
 * entry, and the app refuses every executeAction while
 * `isClientAgentRegistered` is false, so left unhandled a single unclean
 * disconnect makes the device actions permanently unavailable.
 *
 * Matches the whole `App agent '<name>' already exists` phrase rather than
 * searching for the agent name anywhere in the text. A bare substring test
 * would also fire on a collision reported for an agent whose name merely starts
 * with this one, and on any unrelated error that happens to mention both.
 * Deliberately strict, because the caller reacts by claiming the agent is
 * registered: a missed match degrades to the visible pre-existing failure,
 * whereas a false match hides it. The quoting around the name is the one part
 * left loose, since it carries no meaning and is the likeliest thing to change
 * on the server.
 */
internal fun isAgentAlreadyRegisteredError(error: String?, agentName: String): Boolean {
    val text = error?.trim().orEmpty()
    if (text.isEmpty() || agentName.isBlank()) {
        return false
    }
    val quote = """['"`]?"""
    val pattern = Regex(
        """app\s+agent\s+$quote${Regex.escape(agentName)}$quote\s+already\s+exists""",
        RegexOption.IGNORE_CASE
    )
    return pattern.containsMatchIn(text)
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

data class PendingYesNoPrompt(
    val requestId: String?,
    val prompt: String
)
