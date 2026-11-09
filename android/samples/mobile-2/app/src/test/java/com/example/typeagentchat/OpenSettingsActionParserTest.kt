package com.example.typeagentchat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OpenSettingsActionParserTest {
    private fun payload(screen: Any?): JSONObject =
        JSONObject()
            .put("originalRequest", "Turn on wifi")
            .put("screen", screen)

    @Test
    fun parsesEverySchemaNameTheEnumDeclares() {
        AndroidSettingsScreen.entries.forEach { screen ->
            assertEquals(
                "Screen ${screen.schemaName} should parse",
                screen,
                parseOpenSettingsActionPayload(payload(screen.schemaName))?.screen
            )
        }
    }

    @Test
    fun acceptsDifferentCasingFromTheModel() {
        assertEquals(
            AndroidSettingsScreen.Wifi,
            parseOpenSettingsActionPayload(payload("WiFi"))?.screen
        )
        assertEquals(
            AndroidSettingsScreen.AirplaneMode,
            parseOpenSettingsActionPayload(payload("airplanemode"))?.screen
        )
    }

    @Test
    fun rejectsAnythingOutsideTheAllowlist() {
        // The enum is the security control: a free-form value must never reach
        // an Intent action, or openSettings becomes "start any system activity".
        assertNull(parseOpenSettingsActionPayload(payload("android.settings.SETTINGS")))
        assertNull(parseOpenSettingsActionPayload(payload("developerOptions")))
        assertNull(parseOpenSettingsActionPayload(payload("android.intent.action.CALL")))
        assertNull(parseOpenSettingsActionPayload(payload("")))
    }

    @Test
    fun rejectsMissingBlankAndNonStringScreens() {
        assertNull(parseOpenSettingsActionPayload(JSONObject()))
        assertNull(parseOpenSettingsActionPayload(payload("   ")))
        assertNull(parseOpenSettingsActionPayload(payload(JSONObject.NULL)))
        assertNull(parseOpenSettingsActionPayload(payload(7)))
        assertNull(parseOpenSettingsActionPayload(null))
        assertNull(parseOpenSettingsActionPayload("wifi"))
    }

    @Test
    fun schemaNamesAreUnique() {
        val names = AndroidSettingsScreen.entries.map { it.schemaName }

        assertEquals(names.size, names.toSet().size)
    }
}
