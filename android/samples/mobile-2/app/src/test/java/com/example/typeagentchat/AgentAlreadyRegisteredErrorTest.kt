package com.example.typeagentchat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A reconnect that resumes a conversation whose previous registration outlived
 * its socket must recover, because the app refuses every executeAction while it
 * believes registration failed. Only the collision is benign though: a genuine
 * registration failure has to keep surfacing, otherwise the app would claim the
 * actions are live and then silently reject them.
 */
class AgentAlreadyRegisteredErrorTest {

    @Test
    fun `the server's collision error is recognised`() {
        assertTrue(
            isAgentAlreadyRegisteredError(
                "App agent 'androidDevice' already exists",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `surrounding whitespace and casing from RPC wrapping do not hide it`() {
        assertTrue(
            isAgentAlreadyRegisteredError(
                "  App Agent 'androidDevice' Already Exists  ",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `a collision reported for another agent is not treated as ours`() {
        assertFalse(
            isAgentAlreadyRegisteredError(
                "App agent 'browser' already exists",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `an agent whose name merely starts with ours is not treated as ours`() {
        assertFalse(
            isAgentAlreadyRegisteredError(
                "App agent 'androidDeviceLegacy' already exists",
                AndroidDeviceAgent.NAME
            )
        )
        assertFalse(
            isAgentAlreadyRegisteredError(
                "App agent androidDeviceLegacy already exists",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `the agent name may be quoted any way the server chooses`() {
        listOf(
            "App agent \"androidDevice\" already exists",
            "App agent `androidDevice` already exists",
            "App agent androidDevice already exists"
        ).forEach { error ->
            assertTrue(error, isAgentAlreadyRegisteredError(error, AndroidDeviceAgent.NAME))
        }
        // Loosening the quoting must not loosen the name match itself.
        assertFalse(
            isAgentAlreadyRegisteredError(
                "App agent \"androidDeviceLegacy\" already exists",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `the phrase is still found when the server wraps it in context`() {
        assertTrue(
            isAgentAlreadyRegisteredError(
                "Error: App agent 'androidDevice' already exists.",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `an unrelated error that happens to mention the agent is not a collision`() {
        assertFalse(
            isAgentAlreadyRegisteredError(
                "Conversation for androidDevice already exists",
                AndroidDeviceAgent.NAME
            )
        )
    }

    @Test
    fun `real registration failures still surface`() {
        assertFalse(
            isAgentAlreadyRegisteredError(
                "Error parsing schema 'androidDevice': Unhandled type node ParenthesizedType",
                AndroidDeviceAgent.NAME
            )
        )
        assertFalse(isAgentAlreadyRegisteredError("Disconnected", AndroidDeviceAgent.NAME))
        assertFalse(
            isAgentAlreadyRegisteredError("WebSocket is not connected.", AndroidDeviceAgent.NAME)
        )
        assertFalse(isAgentAlreadyRegisteredError("", AndroidDeviceAgent.NAME))
        assertFalse(isAgentAlreadyRegisteredError(null, AndroidDeviceAgent.NAME))
    }

    @Test
    fun `a blank agent name never matches`() {
        assertFalse(isAgentAlreadyRegisteredError("App agent 'androidDevice' already exists", ""))
    }

    @Test
    fun `a reused registration is reported differently from a clean one`() {
        // A reused registration may be bound to a dead connection, so the UI
        // must not present it as an ordinary successful registration.
        assertNotEquals(
            WebSocketManager.STATUS_AGENT_REGISTERED,
            WebSocketManager.STATUS_AGENT_REGISTRATION_REUSED
        )
    }
}
