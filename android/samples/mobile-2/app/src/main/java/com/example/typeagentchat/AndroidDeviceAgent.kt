package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject

internal object AndroidDeviceAgent {
    const val NAME = "androidDevice"
    const val CHANNEL_NAME = "agent:$NAME"
    const val SCHEMA_ASSET = "typeagent/androidDeviceSchema.ts"
    private const val AGENT_DESCRIPTION =
        "Acts on this Android device: sets alarms and countdown timers, shows the " +
            "alarm and timer lists, searches for nearby places, shows a place on the " +
            "map, opens the dialer or a text message draft, runs a web search, " +
            "opens web pages, drafts email, shares text with another app, opens " +
            "device settings screens, drafts calendar events and plays music."

    fun createRegistrationParams(
        conversationId: String,
        schemaContent: String,
        instanceId: String,
        displayName: String
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
            // Identifies this device so several devices can share one
            // `androidDevice` agent, and so a reconnect replaces this device
            // instead of adding another. `multiInstance` is the opt-in: without
            // it the server rejects the second device, as it does for clients
            // that expect to be the only host of their agent.
            .put("instanceId", instanceId)
            .put("displayName", displayName)
            .put("multiInstance", true)
    }

    /**
     * Params for `unregisterClientAgent`. Carries no `instanceId` on purpose:
     * the server resolves the call to the calling connection's own
     * registration, so it is inert when that connection has none. Naming an
     * instance would give the collision shim a way to drop another device.
     */
    fun createUnregistrationParams(conversationId: String): JSONObject {
        return JSONObject()
            .put("name", NAME)
            .put("conversationId", conversationId)
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
        // Not every action has parameters: `showAlarms` and `showTimers` take
        // none, so the dispatcher sends no `parameters` object at all for them.
        val parameters = action.optJSONObject("parameters")
        if (parameters == null && actionName !in NO_PARAMETER_ACTIONS) {
            return AndroidDeviceActionParseResult.ActionError(
                "Action '$actionName' is missing parameters."
            )
        }

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

            "showAlarms" -> AndroidDeviceActionParseResult.Success(AndroidDeviceAction.ShowAlarms)

            "showTimers" -> AndroidDeviceActionParseResult.Success(AndroidDeviceAction.ShowTimers)

            "showLocation" -> {
                val parsed = parseShowLocationActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid showLocation parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.ShowLocation(parsed))
            }

            "dialPhoneNumber" -> {
                val parsed = parseDialPhoneNumberActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid dialPhoneNumber parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.DialPhoneNumber(parsed))
            }

            "composeSms" -> {
                val parsed = parseComposeSmsActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid composeSms parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.ComposeSms(parsed))
            }

            "webSearch" -> {
                val parsed = parseWebSearchActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid webSearch parameters."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.WebSearch(parsed))
            }

            "openWebPage" -> {
                val parsed = parseOpenWebPageActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid openWebPage parameters: the url must be an " +
                            "absolute http:// or https:// address."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.OpenWebPage(parsed))
            }

            "composeEmail" -> {
                val parsed = parseComposeEmailActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid composeEmail parameters: every recipient must be a " +
                            "valid email address and the draft cannot be empty."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.ComposeEmail(parsed))
            }

            "shareText" -> {
                val parsed = parseShareTextActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid shareText parameters: text is required."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.ShareText(parsed))
            }

            "openSettings" -> {
                val parsed = parseOpenSettingsActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid openSettings parameters: screen must be one of " +
                            AndroidSettingsScreen.entries.joinToString { it.schemaName } + "."
                    )
                AndroidDeviceActionParseResult.Success(AndroidDeviceAction.OpenSettings(parsed))
            }

            "createCalendarEvent" -> {
                val parsed = parseCreateCalendarEventActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid createCalendarEvent parameters: title is required and " +
                            "start/end must be local ISO-8601 values such as " +
                            "2026-08-24T15:00, with end after start."
                    )
                AndroidDeviceActionParseResult.Success(
                    AndroidDeviceAction.CreateCalendarEvent(parsed)
                )
            }

            "playMusicFromSearch" -> {
                val parsed = parsePlayMusicFromSearchActionPayload(parameters)
                    ?: return AndroidDeviceActionParseResult.ActionError(
                        "Invalid playMusicFromSearch parameters: query is required and " +
                            "focus must be one of " +
                            MusicSearchFocus.entries.joinToString { it.schemaName } + "."
                    )
                AndroidDeviceActionParseResult.Success(
                    AndroidDeviceAction.PlayMusicFromSearch(parsed)
                )
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

    /** Actions whose schema declares no `parameters` object. */
    private val NO_PARAMETER_ACTIONS = setOf("showAlarms", "showTimers")
}

internal sealed interface AndroidDeviceAction {
    data class Alarm(val action: SetAlarmAction) : AndroidDeviceAction
    data class Timer(val action: SetTimerAction) : AndroidDeviceAction
    data class SearchNearby(val action: SearchNearbyAction) : AndroidDeviceAction
    data object ShowAlarms : AndroidDeviceAction
    data object ShowTimers : AndroidDeviceAction
    data class ShowLocation(val action: ShowLocationAction) : AndroidDeviceAction
    data class DialPhoneNumber(val action: DialPhoneNumberAction) : AndroidDeviceAction
    data class ComposeSms(val action: ComposeSmsAction) : AndroidDeviceAction
    data class WebSearch(val action: WebSearchAction) : AndroidDeviceAction
    data class OpenWebPage(val action: OpenWebPageAction) : AndroidDeviceAction
    data class ComposeEmail(val action: ComposeEmailAction) : AndroidDeviceAction
    data class ShareText(val action: ShareTextAction) : AndroidDeviceAction
    data class OpenSettings(val action: OpenSettingsAction) : AndroidDeviceAction
    data class CreateCalendarEvent(val action: CreateCalendarEventAction) : AndroidDeviceAction
    data class PlayMusicFromSearch(
        val action: PlayMusicFromSearchAction
    ) : AndroidDeviceAction
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
