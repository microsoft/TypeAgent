package com.example.typeagentchat

import org.json.JSONObject

/**
 * What a music search query names.
 *
 * Mirrors `MusicSearchFocus` in `androidDeviceSchema.ts`; the two lists are
 * kept in step by `AndroidDeviceSchemaAssetTest`.
 */
internal enum class MusicSearchFocus(val schemaName: String) {
    /** Let the music app decide what the query means. */
    Any("any"),
    Artist("artist"),
    Album("album"),
    Song("song"),
    Playlist("playlist");

    companion object {
        fun fromSchemaName(name: String): MusicSearchFocus? =
            entries.firstOrNull { it.schemaName.equals(name, ignoreCase = true) }
    }
}

internal data class PlayMusicFromSearchAction(
    val originalRequest: String,
    val query: String,
    val focus: MusicSearchFocus
)

/**
 * Parses the `parameters` of the `playMusicFromSearch` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; query: string; focus?: MusicSearchFocus }
 * ```
 *
 * The result is used with `MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH`,
 * which asks whichever music app claims it to play the best match. How well
 * that works is entirely up to the installed app - several streaming apps
 * handle the intent poorly or not at all - so the action reports what it
 * dispatched, not what ended up playing.
 *
 * An unrecognised focus fails the action rather than falling back to [Any]: the
 * fallback would look like success while searching for something broader than
 * the user asked for.
 */
internal fun parsePlayMusicFromSearchActionPayload(data: Any?): PlayMusicFromSearchAction? {
    val payload = data as? JSONObject ?: return null
    val query = payload.sanitizedActionText("query")
    if (query.isEmpty()) {
        return null
    }

    // Read `focus` through `opt` rather than `sanitizedActionText` so that a
    // wrong-typed value (a number, an object) is rejected instead of collapsing
    // to the empty string and being mistaken for an omitted field.
    val focus = when (val rawFocus = payload.opt("focus")) {
        null, JSONObject.NULL -> MusicSearchFocus.Any
        is String -> {
            val sanitized = sanitizeActionText(rawFocus)
            if (sanitized.isEmpty()) {
                MusicSearchFocus.Any
            } else {
                MusicSearchFocus.fromSchemaName(sanitized) ?: return null
            }
        }
        else -> return null
    }

    return PlayMusicFromSearchAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        query = query,
        focus = focus
    )
}
