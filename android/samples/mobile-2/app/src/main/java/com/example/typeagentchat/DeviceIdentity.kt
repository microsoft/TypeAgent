package com.example.typeagentchat

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.util.UUID

/**
 * Who this device is, from the server's point of view.
 *
 * The server keys one `androidDevice` agent by `instanceId`, so several
 * devices can share it and a reconnect replaces this device rather than adding
 * another. An interface so `WebSocketManager` stays constructible in plain JVM
 * unit tests, which have no `Context`.
 */
interface DeviceIdentity {
    val instanceId: String
    val displayName: String
}

/**
 * `SharedPreferences`-backed identity. The id is generated once and kept, so
 * it survives restarts. It is a random UUID, never a hardware identifier,
 * which would need permissions and would follow the user across apps.
 */
class StoredDeviceIdentity(context: Context) : DeviceIdentity {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override val instanceId: String = loadOrCreateInstanceId()

    /** The device model, which is what the user recognizes in a device list. */
    override val displayName: String
        get() = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android device"

    private fun loadOrCreateInstanceId(): String {
        val existing = prefs.getString(KEY_INSTANCE_ID, null)
        if (!existing.isNullOrBlank()) {
            return existing
        }
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_INSTANCE_ID, generated).apply()
        return generated
    }

    private companion object {
        const val PREFS_NAME = "typeagent_device_identity"
        const val KEY_INSTANCE_ID = "instance_id"
    }
}
