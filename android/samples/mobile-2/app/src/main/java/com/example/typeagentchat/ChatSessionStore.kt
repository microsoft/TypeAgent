package com.example.typeagentchat

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * The chat transcript plus the server conversation it belongs to.
 *
 * [conversationId] is stored so a restored transcript can be checked against the
 * conversation the server actually hands back on the next join. If the server
 * has moved on to a different conversation the old transcript is no longer a
 * record of anything the agent remembers.
 */
data class PersistedChatSession(
    val conversationId: String?,
    val messages: List<Message>
) {
    companion object {
        val EMPTY = PersistedChatSession(conversationId = null, messages = emptyList())
    }
}

/**
 * A decoded session plus the number of stored messages that retention discarded
 * (aged out, or trimmed by the message cap).
 *
 * A non-zero count means the file on disk still contains messages the app will
 * no longer show, so the caller should rewrite it to actually delete them.
 */
data class DecodedChatSession(
    val session: PersistedChatSession,
    val droppedCount: Int
)


/**
 * Persists the chat transcript so it survives process death.
 *
 * A `ViewModel` only survives configuration changes, so without this the whole
 * conversation disappeared the first time Android reclaimed the backgrounded
 * app process. The TypeAgent server cannot fill the gap: it exposes no history
 * API (`getChatHistory`, `getMessages` and friends all answer "No invoke
 * handler"), so the client has to own its own transcript.
 *
 * `SharedPreferences` is used rather than Room/DataStore to avoid adding
 * dependencies for what is a single small blob. Reads and writes are blocking,
 * so callers must keep them off the main thread.
 */
class ChatSessionStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): PersistedChatSession {
        val raw = prefs.getString(KEY_SESSION, null) ?: return PersistedChatSession.EMPTY
        return try {
            val decoded = ChatSessionSerializer.decodeDetailed(raw)
            if (decoded.droppedCount > 0) {
                // Retention filters on read, but the expired messages are still
                // sitting in the file until something else triggers a save.
                // Purge them now so "deleted" means deleted rather than hidden.
                Log.d(TAG, "Purging ${decoded.droppedCount} stale messages from disk")
                save(decoded.session)
            }
            decoded.session
        } catch (error: Exception) {
            // A partially written or stale-format blob must not brick startup.
            Log.e(TAG, "Discarding unreadable persisted chat session", error)
            clear()
            PersistedChatSession.EMPTY
        }
    }

    /**
     * Writes with `commit()` rather than `apply()`. Every caller is already off
     * the main thread except the teardown flush, which needs the write to have
     * actually landed before the process is free to go away - `apply()` only
     * queues it.
     */
    fun save(session: PersistedChatSession) {
        try {
            prefs.edit()
                .putString(KEY_SESSION, ChatSessionSerializer.encode(session))
                .commit()
        } catch (error: Exception) {
            Log.e(TAG, "Failed to persist chat session", error)
        }
    }

    fun clear() {
        prefs.edit().remove(KEY_SESSION).commit()
    }

    private companion object {
        private const val TAG = "ChatSessionStore"

        /**
         * Backing file is `shared_prefs/$PREFS_NAME.xml`. That exact name is
         * excluded from backups in `res/xml/backup_rules.xml` and
         * `res/xml/data_extraction_rules.xml`, so renaming it here without
         * updating both silently starts uploading transcripts to the cloud.
         */
        private const val PREFS_NAME = "typeagent_chat_session"
        private const val KEY_SESSION = "session"
    }
}

/**
 * JSON encoding for [PersistedChatSession].
 *
 * Kept free of Android framework types so the round-trip is covered by plain
 * JVM unit tests.
 */
object ChatSessionSerializer {

    /**
     * Caps how much transcript is written back to disk. `SharedPreferences`
     * holds the whole blob in memory and rewrites it in full on every commit,
     * so an unbounded transcript would keep growing the cost of every save.
     */
    const val MAX_PERSISTED_MESSAGES = 200

    /**
     * How long a stored message is kept. The message cap alone bounds *size*
     * but not *time*: without this the newest 200 messages would sit on the
     * device forever. Retention is applied on both save and load, so messages
     * also age out while the app is not running.
     */
    const val MAX_MESSAGE_AGE_MILLIS = 30L * 24 * 60 * 60 * 1000

    private const val VERSION = 1

    fun encode(
        session: PersistedChatSession,
        now: Long = System.currentTimeMillis()
    ): String {
        val messages = retain(session.messages, now)
        val array = JSONArray()
        messages.forEach { array.put(encodeMessage(it)) }
        return JSONObject()
            .put("version", VERSION)
            .putOpt("conversationId", session.conversationId)
            .put("messages", array)
            .toString()
    }

    fun decode(
        raw: String,
        now: Long = System.currentTimeMillis()
    ): PersistedChatSession = decodeDetailed(raw, now).session

    /**
     * Same as [decode], but also reports how many stored messages the retention
     * window dropped. The caller needs this to know whether the file on disk
     * still holds expired content that should be rewritten: filtering on read
     * hides old messages, it does not delete them.
     */
    fun decodeDetailed(
        raw: String,
        now: Long = System.currentTimeMillis()
    ): DecodedChatSession {
        val root = JSONObject(raw)
        if (root.optInt("version") != VERSION) {
            return DecodedChatSession(PersistedChatSession.EMPTY, droppedCount = 0)
        }
        val conversationId = root.optString("conversationId").takeIf { it.isNotBlank() }
        val array = root.optJSONArray("messages") ?: JSONArray()
        val messages = ArrayList<Message>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            decodeMessage(item, now)?.let { messages += it }
        }
        val retained = retain(messages, now)
        return DecodedChatSession(
            session = PersistedChatSession(
                conversationId = conversationId,
                messages = retained
            ),
            droppedCount = messages.size - retained.size
        )
    }

    /**
     * Drops messages that are older than the retention window, then keeps only
     * the newest [MAX_PERSISTED_MESSAGES].
     *
     * A timestamp in the future (clock changes, timezone-induced skew) is
     * treated as current rather than expired, so a wrong clock cannot silently
     * delete a live conversation.
     */
    private fun retain(messages: List<Message>, now: Long): List<Message> {
        return messages
            .filter { now - it.timestampMillis <= MAX_MESSAGE_AGE_MILLIS }
            .takeLast(MAX_PERSISTED_MESSAGES)
    }

    private fun encodeMessage(message: Message): JSONObject {
        val segments = JSONArray()
        message.segments.forEach { segment ->
            segments.put(
                JSONObject()
                    .put("text", segment.text)
                    .put("format", segment.format.name)
                    .put("kind", segment.kind.name)
            )
        }
        return JSONObject()
            .put("id", message.id)
            .put("isUser", message.isUser)
            .putOpt("requestId", message.requestId)
            .put("timestamp", message.timestampMillis)
            .put("segments", segments)
    }

    private fun decodeMessage(item: JSONObject, now: Long): Message? {
        val segmentsArray = item.optJSONArray("segments") ?: return null
        val segments = ArrayList<MessageSegment>(segmentsArray.length())
        for (index in 0 until segmentsArray.length()) {
            val segment = segmentsArray.optJSONObject(index) ?: continue
            segments += MessageSegment(
                text = segment.optString("text"),
                format = parseFormat(segment.optString("format")),
                kind = MessageKind.parse(segment.optString("kind"))
            )
        }
        if (segments.isEmpty()) {
            return null
        }
        val id = item.optString("id").takeIf { it.isNotBlank() } ?: return null
        return Message(
            id = id,
            segments = segments,
            isUser = item.optBoolean("isUser"),
            requestId = item.optString("requestId").takeIf { it.isNotBlank() },
            // Restored bubbles are always sealed. Nothing can still be streaming
            // into them after a restart, and an unsealed bubble would both render
            // "Responding..." forever and be a candidate for the
            // `indexOfLast { !isUser && !isFinal }` lookup in
            // WebSocketManager.finalizeAssistantMessage.
            isFinal = true,
            // Transcripts written before timestamps existed are treated as
            // current, so upgrading the app grants them one full retention
            // window rather than deleting the user's history on first launch.
            timestampMillis = item.optLong("timestamp", now).takeIf { it > 0L } ?: now
        )
    }

    private fun parseFormat(raw: String?): MessageFormat {
        return when (raw?.trim()?.uppercase()) {
            MessageFormat.MARKDOWN.name -> MessageFormat.MARKDOWN
            else -> MessageFormat.TEXT
        }
    }
}
