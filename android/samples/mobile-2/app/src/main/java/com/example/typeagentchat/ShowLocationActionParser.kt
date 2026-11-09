package com.example.typeagentchat

import org.json.JSONObject

internal data class ShowLocationAction(
    val originalRequest: String,
    val location: String
)

/**
 * Parses the `parameters` of the `showLocation` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; location: string }
 * ```
 *
 * The location is handed to the maps app as `geo:0,0?q=<location>`, the same
 * URI shape [buildGeoSearchUri] already builds for `searchNearby`. Android
 * documents that form as "show this place", with the `0,0` coordinates acting
 * as "wherever the query resolves to" - so no location permission is involved
 * and no coordinates are ever read from the device.
 */
internal fun parseShowLocationActionPayload(data: Any?): ShowLocationAction? {
    val payload = data as? JSONObject ?: return null
    val location = payload.sanitizedActionText("location")
    if (location.isEmpty()) {
        return null
    }

    return ShowLocationAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        location = location
    )
}
