package com.example.typeagentchat

import org.json.JSONObject

/**
 * The closed set of settings screens the agent may open.
 *
 * This enum *is* the security control for `openSettings`. The model names a
 * member; it never supplies an intent action string. Accepting a free-form
 * action would turn one convenience action into "start any exported system
 * activity", which is exactly the shape of bug prompt injection looks for.
 * Anything unrecognised fails the action instead of being passed through.
 *
 * Mirrors `AndroidSettingsScreen` in `androidDeviceSchema.ts`; the two lists
 * are kept in step by `AndroidDeviceSchemaAssetTest`.
 */
internal enum class AndroidSettingsScreen(val schemaName: String, val displayName: String) {
    Settings("settings", "settings"),
    Wifi("wifi", "wifi settings"),
    Bluetooth("bluetooth", "Bluetooth settings"),
    Display("display", "display settings"),
    Sound("sound", "sound settings"),
    Location("location", "location settings"),
    Battery("battery", "battery settings"),
    AirplaneMode("airplaneMode", "airplane mode settings"),
    DateAndTime("dateAndTime", "date and time settings"),
    Storage("storage", "storage settings"),
    Accessibility("accessibility", "accessibility settings"),
    Security("security", "security settings"),

    /** This app's own details page - never another app's. */
    AppInfo("appInfo", "this app's settings");

    companion object {
        /**
         * Matched case-insensitively because the schema name is the contract but
         * models routinely emit "Wifi" or "WIFI"; the mapping stays closed
         * either way.
         */
        fun fromSchemaName(name: String): AndroidSettingsScreen? =
            entries.firstOrNull { it.schemaName.equals(name, ignoreCase = true) }
    }
}

internal data class OpenSettingsAction(
    val originalRequest: String,
    val screen: AndroidSettingsScreen
)

/**
 * Parses the `parameters` of the `openSettings` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; screen: AndroidSettingsScreen }
 * ```
 *
 * Opening a settings screen is the only thing an ordinary app can do about
 * wifi, Bluetooth or Do Not Disturb - the platform blocks direct toggling - so
 * this action hands the user to the right screen rather than pretending to
 * change anything itself.
 */
internal fun parseOpenSettingsActionPayload(data: Any?): OpenSettingsAction? {
    val payload = data as? JSONObject ?: return null
    val screen = AndroidSettingsScreen
        .fromSchemaName(payload.sanitizedActionText("screen"))
        ?: return null

    return OpenSettingsAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        screen = screen
    )
}
