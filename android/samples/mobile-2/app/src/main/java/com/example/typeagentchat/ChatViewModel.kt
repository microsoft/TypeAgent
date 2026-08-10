package com.example.typeagentchat

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * A client action that the agent asked the app to perform and that can only be
 * carried out by an Activity (it ends in `startActivity`).
 *
 * These are delivered as events rather than state: the ViewModel outlives the
 * Activity across configuration changes, so it must not hold a reference to the
 * Activity that will ultimately handle them.
 */
internal sealed interface ClientAction {
    data class Alarm(val action: SetAlarmAction) : ClientAction
    data class Timer(val action: SetTimerAction) : ClientAction
    data class SearchNearby(val action: SearchNearbyAction) : ClientAction
}

/**
 * Owns the chat session so it survives configuration changes, and persists it
 * so it also survives process death.
 *
 * The [WebSocketManager] used to be a field on `MainActivity`, which meant a
 * theme change, rotation, font-scale change or locale change destroyed the
 * socket and the entire message list and started a brand new conversation.
 * `WebSocketManager.disconnect()` also shuts the OkHttp client's executor down
 * for good, so the instance could not be reused even in principle. Holding it
 * here scopes it to the logical screen instead of the Activity instance.
 *
 * A ViewModel still dies with its process though, which is routine as soon as
 * the user switches to another app. The transcript is therefore mirrored to
 * [ChatSessionStore] and restored on the next start. The server cannot supply
 * that history - it exposes no history RPC - but it does keep handing back the
 * same conversation, so a restored transcript still lines up with what the
 * agent remembers.
 */
class ChatViewModel(application: Application) : AndroidViewModel(application) {

    private val webSocketManager = WebSocketManager()
    private val sessionStore = ChatSessionStore(application)

    val messages: StateFlow<List<Message>> = webSocketManager.messages
    val connectionStatus: StateFlow<ConnectionStatus> = webSocketManager.connectionStatus
    val pendingYesNoPrompt: StateFlow<PendingYesNoPrompt?> = webSocketManager.pendingYesNoPrompt

    private val _inputText = MutableStateFlow("")
    val inputText: StateFlow<String> = _inputText

    /**
     * Buffered so an action that arrives while the Activity is being recreated
     * is replayed once it resumes instead of being dropped by the RESUMED guard
     * in `MainActivity.launchExternalIntent`.
     */
    private val clientActionEvents = Channel<ClientAction>(Channel.UNLIMITED)
    internal val clientActions: Flow<ClientAction> = clientActionEvents.receiveAsFlow()

    private var hasConnected = false

    /** The conversation the restored transcript was recorded against. */
    @Volatile
    private var restoredConversationId: String? = null

    /**
     * Completes once the persisted transcript has been read back and handed to
     * the socket. Connecting waits on it so a slow disk read can never race the
     * first inbound message.
     */
    private val restored = CompletableDeferred<Unit>()

    init {
        webSocketManager.setClientActionHandler(object : WebSocketManager.ClientActionHandler {
            override fun onSetAlarm(action: SetAlarmAction) {
                clientActionEvents.trySend(ClientAction.Alarm(action))
            }

            override fun onSetTimer(action: SetTimerAction) {
                clientActionEvents.trySend(ClientAction.Timer(action))
            }

            override fun onSearchNearby(action: SearchNearbyAction) {
                clientActionEvents.trySend(ClientAction.SearchNearby(action))
            }
        })

        viewModelScope.launch {
            val session = withContext(Dispatchers.IO) { sessionStore.load() }
            restoredConversationId = session.conversationId
            webSocketManager.restoreMessages(session.messages)
            Log.d(
                TAG,
                "Restored ${session.messages.size} messages " +
                    "for conversationId=${session.conversationId ?: "none"}"
            )
            restored.complete(Unit)
        }

        observeSessionForPersistence()
        reconcileRestoredTranscript()
    }

    /**
     * Mirrors the transcript back to disk.
     *
     * Writes are debounced because `_messages` is re-emitted for every streamed
     * display chunk, while `SharedPreferences` rewrites the whole file on each
     * commit - so saving per emission would re-encode and rewrite the entire
     * transcript dozens of times for a single agent response. `collectLatest`
     * cancels the pending delay whenever a newer value arrives, so a burst of
     * chunks collapses into one write once the stream settles.
     *
     * The initial value is dropped so the empty list the socket starts with
     * cannot overwrite a transcript that is still being read back.
     */
    private fun observeSessionForPersistence() {
        viewModelScope.launch {
            restored.await()
            webSocketManager.messages.drop(1).collectLatest { messages ->
                delay(SAVE_DEBOUNCE_MS)
                val conversationId =
                    webSocketManager.joinedConversationId.value ?: restoredConversationId
                withContext(Dispatchers.IO) {
                    sessionStore.save(
                        PersistedChatSession(
                            conversationId = conversationId,
                            messages = messages
                        )
                    )
                }
            }
        }
    }

    /**
     * Drops a restored transcript that belongs to a conversation the server has
     * since replaced, so the user is not left reading history the agent has no
     * memory of.
     */
    private fun reconcileRestoredTranscript() {
        viewModelScope.launch {
            restored.await()
            val previous = restoredConversationId ?: return@launch
            val joined = webSocketManager.joinedConversationId.filterNotNull().first()
            if (joined == previous) {
                return@launch
            }
            Log.w(
                TAG,
                "Server conversation changed ($previous -> $joined); dropping stale transcript"
            )
            webSocketManager.clearMessages()
        }
    }

    /** Connects on first use only, so Activity recreation does not restart the session. */
    fun connectIfNeeded(url: String, tunnelToken: String?) {
        if (hasConnected) {
            return
        }
        hasConnected = true
        viewModelScope.launch {
            restored.await()
            webSocketManager.connect(url = url, tunnelToken = tunnelToken)
        }
    }

    fun reconnect(url: String, tunnelToken: String?) {
        hasConnected = true
        viewModelScope.launch {
            restored.await()
            webSocketManager.connect(url = url, tunnelToken = tunnelToken)
        }
    }

    fun onInputTextChange(text: String) {
        _inputText.value = text
    }

    private val isConnected: Boolean
        get() = connectionStatus.value.state == ConnectionStatus.State.CONNECTED

    val canSend: Boolean
        get() = isConnected && _inputText.value.isNotBlank()

    /** @return true when the message was handed to the socket and the input was cleared. */
    fun submitMessage(): Boolean {
        return sendText(_inputText.value)
    }

    /**
     * Sends dictated speech straight through instead of parking it in the input
     * box and waiting for a Send tap. If the socket is down the text is kept in
     * the input box so nothing spoken is lost.
     */
    fun onRecognizedText(recognizedText: String): Boolean {
        val merged = mergeSpeechInputText(
            currentText = _inputText.value,
            recognizedText = recognizedText
        )
        if (!isConnected) {
            _inputText.value = merged
            return false
        }
        return sendText(merged)
    }

    fun respondToPendingYesNo(yes: Boolean): Boolean = webSocketManager.respondToPendingYesNo(yes)

    /**
     * Starts a new chat: clears the on-screen transcript and the copy on disk.
     *
     * This is a client-side reset only. `joinConversation` keeps returning the
     * same server-side conversation, so the agent's own memory is untouched -
     * the server exposes no RPC to start a fresh one.
     */
    fun startNewChat() {
        webSocketManager.clearMessages()
        viewModelScope.launch {
            withContext(Dispatchers.IO) { sessionStore.clear() }
        }
    }

    private fun sendText(text: String): Boolean {
        val message = text.trim()
        if (!isConnected || message.isBlank()) {
            return false
        }
        webSocketManager.sendMessage(message)
        _inputText.value = ""
        return true
    }

    override fun onCleared() {
        webSocketManager.setClientActionHandler(null)
        webSocketManager.disconnect()
        clientActionEvents.close()
        flushSessionToDisk()
        super.onCleared()
    }

    /**
     * Writes the transcript one last time as the screen goes away.
     *
     * `viewModelScope` is cancelled *before* [onCleared] runs, which takes the
     * debounced writer down with it. Without this, anything changed in the last
     * [SAVE_DEBOUNCE_MS] never reaches disk, and neither do the open bubbles
     * that [WebSocketManager.disconnect] just sealed above - those are mutated
     * after the writer is already dead, so they could never be saved at all.
     *
     * Skipped until the restore has finished: a teardown that races the initial
     * read would otherwise persist the still-empty transcript over the stored
     * one and lose the whole history.
     */
    private fun flushSessionToDisk() {
        if (!restored.isCompleted) {
            return
        }
        sessionStore.save(
            PersistedChatSession(
                conversationId = webSocketManager.joinedConversationId.value
                    ?: restoredConversationId,
                messages = webSocketManager.messages.value
            )
        )
    }

    private companion object {
        private const val TAG = "ChatViewModel"

        /**
         * Long enough to collapse a burst of streamed display chunks into one
         * write, short enough that an unexpected process kill loses at most
         * this much of the transcript.
         */
        private const val SAVE_DEBOUNCE_MS = 400L
    }
}

internal fun mergeSpeechInputText(
    currentText: String,
    recognizedText: String
): String {
    return if (currentText.isBlank()) {
        recognizedText
    } else {
        "$currentText $recognizedText"
    }
}
