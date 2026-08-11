package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidDeviceAgentTest {
    @Test
    fun registrationIncludesInlineSchemaAndExecuteAction() {
        val registration = AndroidDeviceAgent.createRegistrationParams(
            conversationId = "conversation-1",
            schemaContent = "export type AndroidDeviceAction = never;"
        )

        assertEquals(AndroidDeviceAgent.NAME, registration.getString("name"))
        assertEquals("conversation-1", registration.getString("conversationId"))
        assertEquals(
            "executeAction",
            registration.getJSONArray("agentInterface").getString(0)
        )
        assertEquals(
            "export type AndroidDeviceAction = never;",
            registration
                .getJSONObject("manifest")
                .getJSONObject("schema")
                .getJSONObject("schemaFile")
                .getString("content")
        )
    }

    @Test
    fun parsesSetTimerExecuteAction() {
        val parameters = JSONObject()
            .put("originalRequest", "Set a timer for 30 seconds")
            .put("durationInSeconds", 30)
        val action = JSONObject()
            .put("actionName", "setTimer")
            .put("parameters", parameters)
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.Success)
        val timer = (parsed as AndroidDeviceActionParseResult.Success).action
            as AndroidDeviceAction.Timer
        assertEquals(30, timer.action.durationInSeconds)
    }

    @Test
    fun parsesSetAlarmExecuteAction() {
        val parameters = JSONObject()
            .put("originalRequest", "Set an alarm for 6:30")
            .put("time", "06:30")
        val action = JSONObject()
            .put("actionName", "setAlarm")
            .put("parameters", parameters)
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.Success)
        val alarm = (parsed as AndroidDeviceActionParseResult.Success).action
            as AndroidDeviceAction.Alarm
        assertEquals(6, alarm.action.hour)
        assertEquals(30, alarm.action.minute)
    }

    @Test
    fun classifiesInvalidParametersAsActionError() {
        val action = JSONObject()
            .put("actionName", "setTimer")
            .put(
                "parameters",
                JSONObject()
                    .put("originalRequest", "Set an invalid timer")
                    .put("durationInSeconds", 0)
            )
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.ActionError)
    }

    @Test
    fun classifiesUnsupportedActionAsActionError() {
        val action = JSONObject()
            .put("actionName", "openMaps")
            .put("parameters", JSONObject())
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.ActionError)
    }

    @Test
    fun serializesActionResults() {
        val success = AndroidDeviceAgent.createSuccessResult("Timer request sent for 30 seconds")
        val failure = AndroidDeviceAgent.createErrorResult("No timer app")

        assertEquals("Timer request sent for 30 seconds", success.getString("historyText"))
        assertEquals("Timer request sent for 30 seconds", success.getString("displayContent"))
        assertEquals(0, success.getJSONArray("entities").length())
        assertEquals("No timer app", failure.getString("error"))
    }
}
