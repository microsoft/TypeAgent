package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject

internal object AndroidDeviceAgent {
    const val NAME = "androidDevice"
    const val CHANNEL_NAME = "agent:$NAME"
    const val SCHEMA_ASSET = "typeagent/androidDeviceSchema.ts"
    private const val AGENT_DESCRIPTION =
        "Sets alarms and countdown timers, and searches for nearby places, on this Android device."

    fun createRegistrationParams(
        conversationId: String,
        schemaContent: String
    ): JSONObject {
        val schemaFile = JSONObject()
            .put("format", "ts")
            .put("content", schemaContent)
        val schema = JSONObject()
            .put("description", AGENT_DESCRIPTION)
            .put("schemaType", "AndroidDeviceAction")
            .put("schemaFile", schemaFile)
        val manifest = JSONObject()
            .put("emojiChar", "\u23F0")
            .put("description", AGENT_DESCRIPTION)
            .put("defaultEnabled", true)
            .put("schemaDefaultEnabled", true)
            .put("actionDefaultEnabled", true)
            .put("schema", schema)

        return JSONObject()
            .put("name", NAME)
            .put("conversationId", conversationId)
            .put("manifest", manifest)
            .put("agentInterface", JSONArray().put("executeAction"))
    }

    fun parseExecuteAction(args: JSONArray): AndroidDeviceActionParseResult {
        val invocation = args.optJSONObject(0)
            ?: return AndroidDeviceActionParseResult.ProtocolError(
                "executeAction requires an invocation object."
            )
        val action = invocation.optJSONObject("action")
            ?: return AndroidDeviceActionParseResult.ProtocolError(
                "executeAction invocation is missing action."
            )
        val actionName = action.optString("actionName").trim()
        if (actionName.isEmpty()) {
            return AndroidDeviceActionParseResult.ProtocolError(
                "executeAction action is missing actionName."
            )
        }
        val parameters = action.optJSONObject("parameters")
            ?: return AndroidDeviceActionParseResult.ActionError(
                "Action '$actionName' is missing parameters."
            )

        return when (actionName) {
            "setAlarm" -> {
                val parsed = parseSetAlarmActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid setAlarm parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.Alarm(parsed))
            }

            "setTimer" -> {
                val parsed = parseSetTimerActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid setTimer parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.Timer(parsed))
            }

            "searchNearby" -> {
                val parsed = parseSearchNearbyActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid searchNearby parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.SearchNearby(parsed))
            }

            else -> AndroidDeviceActionParseResult.ActionError(
                "Unsupported Android agent action: $actionName"
            )
        }
    }

    fun createSuccessResult(message: String): JSONObject {
        return JSONObject()
            .put("historyText", message)
            .put("displayContent", message)
            .put("entities", JSONArray())
    }

    fun createErrorResult(message: String): JSONObject {
        return JSONObject().put("error", message)
    }
}

internal sealed interface AndroidDeviceAction {
    data class Alarm(val action: SetAlarmAction) : AndroidDeviceAction
    data class Timer(val action: SetTimerAction) : AndroidDeviceAction
    data class SearchNearby(val action: SearchNearbyAction) : AndroidDeviceAction
}

internal sealed interface AndroidDeviceActionParseResult {
    data class Success(val action: AndroidDeviceAction) : AndroidDeviceActionParseResult
    data class ActionError(val message: String) : AndroidDeviceActionParseResult
    data class ProtocolError(val message: String) : AndroidDeviceActionParseResult
}

internal sealed interface AndroidDeviceExecutionResult {
    data class Success(val message: String) : AndroidDeviceExecutionResult
    data class Failure(val message: String) : AndroidDeviceExecutionResult
}
