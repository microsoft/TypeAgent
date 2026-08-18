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
 *
 * Every action carries the `executeAction` completion, because the server is
 * holding an RPC open waiting for the result.
 */
internal sealed interface ClientAction {
    data class Alarm(
        val action: SetAlarmAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class Timer(
        val action: SetTimerAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class SearchNearby(
        val action: SearchNearbyAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class ShowAlarms(
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class ShowTimers(
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class ShowLocation(
        val action: ShowLocationAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class DialPhoneNumber(
        val action: DialPhoneNumberAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class ComposeSms(
        val action: ComposeSmsAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class WebSearch(
        val action: WebSearchAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction

    data class OpenWebPage(
        val action: OpenWebPageAction,
        val completion: (AndroidDeviceExecutionResult) -> Unit
    ) : ClientAction
}

/**
 * Owns the chat conversation so it survives configuration changes, and
 * persists it so it also survives process death.
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
 * [ConversationStore] and restored on the next start, alongside the id of the
 * conversation it belongs to. That id is passed back into
 * [WebSocketManager.connect] so the client rejoins the exact same server-side
 * conversation - the restored transcript then always lines up with what the
 * agent remembers, with no post-hoc reconciliation needed.
 */
class ChatViewModel(application: Application) : AndroidViewModel(application) {

    private val webSocketManager = WebSocketManager()
    private val conversationStore = ConversationStore(application)

    val messages: StateFlow<List<Message>> = webSocketManager.messages
    val connectionStatus: StateFlow<ConnectionStatus> = webSocketManager.connectionStatus
    val pendingYesNoPrompt: StateFlow<PendingYesNoPrompt?> = webSocketManager.pendingYesNoPrompt

    private val _inputText = MutableStateFlow("")
    val inputText: StateFlow<String> = _inputText

    /**
     * Buffered so an action that arrives during the gap between the old
     * Activity being destroyed and the new one being created - a rotation,
     * theme or locale change - is delivered to the new Activity instead of
     * being dropped on the floor.
     *
     * The consumer collects for the Activity's whole lifetime, not just while
     * it is resumed, so a queued action is never left waiting on the user
     * returning to the app. It does wait briefly for a recreated Activity to
     * reach RESUMED before dispatching. Foreground-only enforcement lives in
     * `MainActivity.launchExternalIntent`, which reports the refusal.
     */
    private val clientActionEvents = Channel<ClientAction>(Channel.UNLIMITED)
    internal val clientActions: Flow<ClientAction> = clientActionEvents.receiveAsFlow()

    private var hasConnected = false

    /**
     * The conversation the restored transcript was recorded against, and the
     * one the next connect asks the server to resume.
     */
    @Volatile
    private var savedConversationId: String? = null

    /**
     * Completes once the persisted transcript has been read back and handed to
     * the socket. Connecting waits on it so a slow disk read can never race the
     * first inbound message, and so the saved conversation id is known before
     * the join is issued.
     */
    private val restored = CompletableDeferred<Unit>()

    init {
        webSocketManager.setClientActionHandler(object : WebSocketManager.ClientActionHandler {
            override fun onSetAlarm(
                action: SetAlarmAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.Alarm(action, completion), completion)
            }

            override fun onSetTimer(
                action: SetTimerAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.Timer(action, completion), completion)
            }

            override fun onSearchNearby(
                action: SearchNearbyAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.SearchNearby(action, completion), completion)
            }

            override fun onShowAlarms(completion: (AndroidDeviceExecutionResult) -> Unit) {
                dispatchClientAction(ClientAction.ShowAlarms(completion), completion)
            }

            override fun onShowTimers(completion: (AndroidDeviceExecutionResult) -> Unit) {
                dispatchClientAction(ClientAction.ShowTimers(completion), completion)
            }

            override fun onShowLocation(
                action: ShowLocationAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.ShowLocation(action, completion), completion)
            }

            override fun onDialPhoneNumber(
                action: DialPhoneNumberAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.DialPhoneNumber(action, completion), completion)
            }

            override fun onComposeSms(
                action: ComposeSmsAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.ComposeSms(action, completion), completion)
            }

            override fun onWebSearch(
                action: WebSearchAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.WebSearch(action, completion), completion)
            }

            override fun onOpenWebPage(
                action: OpenWebPageAction,
                completion: (AndroidDeviceExecutionResult) -> Unit
            ) {
                dispatchClientAction(ClientAction.OpenWebPage(action, completion), completion)
            }
        })

        webSocketManager.setStaleConversationHandler {
            // The saved conversation no longer exists on the server, so the
            // join fell back to the default one. The restored transcript is a
            // record of a conversation nothing remembers - drop it rather than
            // graft it onto a different one.
            Log.w(TAG, "Saved conversation is gone; discarding the restored transcript")
            savedConversationId = null
            webSocketManager.clearMessages()
            viewModelScope.launch {
                withContext(Dispatchers.IO) { conversationStore.clear() }
            }
        }

        viewModelScope.launch {
            val conversation = withContext(Dispatchers.IO) { conversationStore.load() }
            savedConversationId = conversation.conversationId
            webSocketManager.restoreMessages(conversation.messages)
            Log.d(
                TAG,
                "Restored ${conversation.messages.size} messages " +
                    "for conversationId=${conversation.conversationId ?: "none"}"
            )
            restored.complete(Unit)
        }

        observeConversationForPersistence()
        observeConversationIdForPersistence()
    }

    /**
     * The conversation the transcript currently belongs to.
     *
     * Prefers the live join over the restored value, and is null only while no
     * join has landed yet - including the gap between a missing conversation
     * being detected and the fallback join completing, where the old id is
     * deliberately no longer trusted.
     */
    private fun currentConversationId(): String? =
        webSocketManager.lastJoinedConversationId.value ?: savedConversationId

    /**
     * Persists the conversation id as soon as a join lands.
     *
     * [observeConversationForPersistence] only writes when the message list
     * changes, so a conversation that is joined but not yet spoken in never
     * reaches disk. That matters most right after the not-found fallback: the
     * stale handler has just wiped the stored record, and without this the new
     * id would sit only in memory until the user happened to send something.
     */
    private fun observeConversationIdForPersistence() {
        viewModelScope.launch {
            restored.await()
            webSocketManager.lastJoinedConversationId
                .filterNotNull()
                .collect { conversationId ->
                    if (conversationId == savedConversationId) {
                        return@collect
                    }
                    savedConversationId = conversationId
                    withContext(Dispatchers.IO) {
                        conversationStore.save(
                            PersistedConversation(
                                conversationId = conversationId,
                                messages = webSocketManager.messages.value
                            )
                        )
                    }
                }
        }
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
    private fun observeConversationForPersistence() {
        viewModelScope.launch {
            restored.await()
            webSocketManager.messages.drop(1).collectLatest { messages ->
                delay(SAVE_DEBOUNCE_MS)
                val conversationId = currentConversationId()
                withContext(Dispatchers.IO) {
                    conversationStore.save(
                        PersistedConversation(
                            conversationId = conversationId,
                            messages = messages
                        )
                    )
                }
            }
        }
    }

    /**
     * Connects on first use only, so Activity recreation does not restart the
     * conversation. The saved conversation id is passed through so the server
     * rejoins it directly.
     */
    fun connectIfNeeded(url: String, tunnelToken: String?, schemaContent: String) {
        if (hasConnected) {
            return
        }
        hasConnected = true
        viewModelScope.launch {
            restored.await()
            webSocketManager.connect(
                url = url,
                tunnelToken = tunnelToken,
                schemaContent = schemaContent,
                resumeConversationId = savedConversationId
            )
        }
    }

    fun reconnect(url: String, tunnelToken: String?, schemaContent: String) {
        hasConnected = true
        viewModelScope.launch {
            restored.await()
            webSocketManager.connect(
                url = url,
                tunnelToken = tunnelToken,
                schemaContent = schemaContent,
                resumeConversationId = webSocketManager.lastJoinedConversationId.value
                    ?: savedConversationId
            )
        }
    }

    /**
     * Queues a client action for the chat Activity.
     *
     * The channel is unbounded, so the only way the send fails is if it has
     * already been closed in [onCleared]. When that happens the agent is still
     * holding an `executeAction` RPC open, so the completion is failed here
     * rather than left hanging until the connection drops.
     */
    private fun dispatchClientAction(
        action: ClientAction,
        completion: ((AndroidDeviceExecutionResult) -> Unit)? = null
    ) {
        if (clientActionEvents.trySend(action).isFailure) {
            Log.w(TAG, "Dropping client action: the chat screen is gone")
            completion?.invoke(
                AndroidDeviceExecutionResult.Failure(
                    "The Android app is no longer able to run this action."
                )
            )
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
     * Clears the chat history: the on-screen transcript and the copy on disk.
     *
     * This is a client-side reset only, matching `@clear` on the other
     * TypeAgent canvases. The server-side conversation is untouched, so the
     * agent keeps its own memory and the next connect resumes the same
     * conversation. Starting a genuinely new server-side conversation would
     * need `createConversation` / `leaveConversation`, which this client does
     * not yet drive.
     *
     * An empty record is written rather than the whole entry removed, because
     * removing it would drop the conversation id too. The debounced writer
     * would put it back a moment later, but a force-stop in that window would
     * leave nothing to resume and the next launch would silently land in the
     * default conversation - breaking the promise above.
     */
    fun clearChatHistory() {
        webSocketManager.clearMessages()
        val conversationId = currentConversationId()
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                conversationStore.save(
                    PersistedConversation(
                        conversationId = conversationId,
                        messages = emptyList()
                    )
                )
            }
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
        webSocketManager.setStaleConversationHandler(null)
        webSocketManager.disconnect()
        clientActionEvents.close()
        flushConversationToDisk()
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
    private fun flushConversationToDisk() {
        if (!restored.isCompleted) {
            return
        }
        conversationStore.save(
            PersistedConversation(
                conversationId = currentConversationId(),
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
