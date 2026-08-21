package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

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
    fun unregistrationIdentifiesTheAgentAndConversation() {
        val unregistration = AndroidDeviceAgent.createUnregistrationParams("conversation-1")

        assertEquals(AndroidDeviceAgent.NAME, unregistration.getString("name"))
        assertEquals("conversation-1", unregistration.getString("conversationId"))
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
    fun parsesSearchNearbyExecuteAction() {
        val parameters = JSONObject()
            .put("originalRequest", "Find coffee shops near me")
            .put("searchTerm", "coffee shops")
        val action = JSONObject()
            .put("actionName", "searchNearby")
            .put("parameters", parameters)
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.Success)
        val search = (parsed as AndroidDeviceActionParseResult.Success).action
            as AndroidDeviceAction.SearchNearby
        assertEquals("coffee shops", search.action.searchTerm)
    }

    @Test
    fun classifiesInvalidSearchNearbyParametersAsActionError() {
        val action = JSONObject()
            .put("actionName", "searchNearby")
            .put(
                "parameters",
                JSONObject()
                    .put("originalRequest", "Find something")
                    .put("searchTerm", "   ")
            )
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.ActionError)
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
            .put("actionName", "sendSms")
            .put("parameters", JSONObject())
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)

        assertTrue(parsed is AndroidDeviceActionParseResult.ActionError)
    }

    private fun parse(actionName: String, parameters: JSONObject?): AndroidDeviceActionParseResult {
        val action = JSONObject().put("actionName", actionName)
        if (parameters != null) {
            action.put("parameters", parameters)
        }
        return AndroidDeviceAgent.parseExecuteAction(
            JSONArray().put(JSONObject().put("action", action))
        )
    }

    private inline fun <reified T : AndroidDeviceAction> parseSuccess(
        actionName: String,
        parameters: JSONObject? = null
    ): T {
        val parsed = parse(actionName, parameters)
        assertTrue("expected success for $actionName but got $parsed", parsed is AndroidDeviceActionParseResult.Success)
        return (parsed as AndroidDeviceActionParseResult.Success).action as T
    }

    @Test
    fun parsesZeroParameterActionsWithNoParametersObject() {
        // The dispatcher omits `parameters` entirely for schema actions that
        // declare none, so requiring the object would make these unreachable.
        assertEquals(
            AndroidDeviceAction.ShowAlarms,
            parseSuccess<AndroidDeviceAction>("showAlarms")
        )
        assertEquals(
            AndroidDeviceAction.ShowTimers,
            parseSuccess<AndroidDeviceAction>("showTimers")
        )
    }

    @Test
    fun stillRequiresParametersForActionsThatTakeThem() {
        val parsed = parse("setTimer", null)

        assertTrue(parsed is AndroidDeviceActionParseResult.ActionError)
    }

    @Test
    fun parsesShowLocationExecuteAction() {
        val parsed = parseSuccess<AndroidDeviceAction.ShowLocation>(
            "showLocation",
            JSONObject()
                .put("originalRequest", "Where is the Space Needle?")
                .put("location", "Space Needle, Seattle")
        )

        assertEquals("Space Needle, Seattle", parsed.action.location)
        assertTrue(parse("showLocation", JSONObject().put("location", "  ")) is AndroidDeviceActionParseResult.ActionError)
    }

    @Test
    fun parsesDialPhoneNumberExecuteAction() {
        val parsed = parseSuccess<AndroidDeviceAction.DialPhoneNumber>(
            "dialPhoneNumber",
            JSONObject()
                .put("originalRequest", "Call the office")
                .put("phoneNumber", "+14255550100")
        )

        assertEquals("+14255550100", parsed.action.phoneNumber)
        assertTrue(
            parse("dialPhoneNumber", JSONObject().put("phoneNumber", "call Sam"))
                is AndroidDeviceActionParseResult.ActionError
        )
    }

    @Test
    fun parsesComposeSmsExecuteAction() {
        val parsed = parseSuccess<AndroidDeviceAction.ComposeSms>(
            "composeSms",
            JSONObject()
                .put("originalRequest", "Text Sam that I am running late")
                .put("message", "Running late")
                .put("phoneNumber", "+14255550100")
        )

        assertEquals("Running late", parsed.action.message)
        assertEquals("+14255550100", parsed.action.phoneNumber)
        assertTrue(
            parse("composeSms", JSONObject().put("message", "   "))
                is AndroidDeviceActionParseResult.ActionError
        )
    }

    @Test
    fun parsesWebSearchExecuteAction() {
        val parsed = parseSuccess<AndroidDeviceAction.WebSearch>(
            "webSearch",
            JSONObject()
                .put("originalRequest", "Search for tide tables")
                .put("query", "tide tables puget sound")
        )

        assertEquals("tide tables puget sound", parsed.action.query)
        assertTrue(
            parse("webSearch", JSONObject().put("query", "   "))
                is AndroidDeviceActionParseResult.ActionError
        )
    }

    @Test
    fun parsesOpenWebPageExecuteAction() {
        val parsed = parseSuccess<AndroidDeviceAction.OpenWebPage>(
            "openWebPage",
            JSONObject()
                .put("originalRequest", "Open the docs")
                .put("url", "https://example.com/docs")
        )

        assertEquals("https://example.com/docs", parsed.action.url)
        assertTrue(
            parse("openWebPage", JSONObject().put("url", "market://details?id=com.example"))
                is AndroidDeviceActionParseResult.ActionError
        )
    }

    @Test
    fun parsesSetAlarmRepeatDays() {
        val parsed = parseSuccess<AndroidDeviceAction.Alarm>(
            "setAlarm",
            JSONObject()
                .put("originalRequest", "Wake me at 6:30 on weekdays")
                .put("time", "06:30")
                .put("days", JSONArray(listOf("monday", "tuesday")))
        )

        assertEquals(listOf(Calendar.MONDAY, Calendar.TUESDAY), parsed.action.days)
    }

    @Test
    fun serializesActionResults() {        val success = AndroidDeviceAgent.createSuccessResult("Timer request sent for 30 seconds")
        val failure = AndroidDeviceAgent.createErrorResult("No timer app")

        assertEquals("Timer request sent for 30 seconds", success.getString("historyText"))
        assertEquals("Timer request sent for 30 seconds", success.getString("displayContent"))
        assertEquals(0, success.getJSONArray("entities").length())
        assertEquals("No timer app", failure.getString("error"))
    }
}
