package com.example.typeagentchat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearPromptLinkTest {

    @Test
    fun `accepts a valid auto-execute prompt`() {
        val result = parseWearPrompt(fields(promptQuery = "set a timer", executeQuery = "true"))

        assertTrue(result is WearPromptResult.Accepted)
        result as WearPromptResult.Accepted
        assertEquals("set a timer", result.prompt.text)
        assertTrue(result.prompt.requestsExecute)
    }

    @Test
    fun `execute is opt-in and case insensitive`() {
        val absent = accepted(fields(promptQuery = "hello"))
        val mixedCase = accepted(fields(promptQuery = "hello", executeQuery = "TrUe"))

        assertFalse(absent.requestsExecute)
        assertTrue(mixedCase.requestsExecute)
    }

    @Test
    fun `intent extra takes precedence over query`() {
        val prompt = accepted(
            fields(
                promptQuery = "query prompt",
                promptExtra = "extra prompt"
            )
        )

        assertEquals("extra prompt", prompt.text)
    }

    @Test
    fun `blank intent extra falls back to query`() {
        val prompt = accepted(fields(promptQuery = "query prompt", promptExtra = "  "))

        assertEquals("query prompt", prompt.text)
    }

    @Test
    fun `trims accepted prompt`() {
        val prompt = accepted(fields(promptQuery = "  hello watch  "))

        assertEquals("hello watch", prompt.text)
    }

    @Test
    fun `accepts prompt at length limit`() {
        val prompt = accepted(fields(promptQuery = "a".repeat(WEAR_PROMPT_MAX_LENGTH)))

        assertEquals(WEAR_PROMPT_MAX_LENGTH, prompt.text.length)
    }

    @Test
    fun `rejects prompt over length limit`() {
        val result = parseWearPrompt(
            fields(promptQuery = "a".repeat(WEAR_PROMPT_MAX_LENGTH + 1))
        )

        assertRejected(WearPromptRejection.TOO_LONG, result)
    }

    @Test
    fun `rejects missing and blank prompts`() {
        assertRejected(WearPromptRejection.NO_PROMPT, parseWearPrompt(fields()))
        assertRejected(
            WearPromptRejection.NO_PROMPT,
            parseWearPrompt(fields(promptQuery = "  "))
        )
    }

    @Test
    fun `rejects wrong scheme or host`() {
        assertRejected(
            WearPromptRejection.NOT_A_PROMPT_LINK,
            parseWearPrompt(fields(scheme = "https", promptQuery = "hello"))
        )
        assertRejected(
            WearPromptRejection.NOT_A_PROMPT_LINK,
            parseWearPrompt(fields(host = "other", promptQuery = "hello"))
        )
    }

    private fun fields(
        scheme: String? = WEAR_LINK_SCHEME,
        host: String? = WEAR_LINK_HOST,
        promptQuery: String? = null,
        executeQuery: String? = null,
        promptExtra: String? = null
    ) = WearLinkFields(
        scheme = scheme,
        host = host,
        promptQuery = promptQuery,
        executeQuery = executeQuery,
        promptExtra = promptExtra
    )

    private fun accepted(fields: WearLinkFields): WearPrompt {
        val result = parseWearPrompt(fields)
        assertTrue("Expected accepted result, got $result", result is WearPromptResult.Accepted)
        return (result as WearPromptResult.Accepted).prompt
    }

    private fun assertRejected(
        expected: WearPromptRejection,
        actual: WearPromptResult
    ) {
        assertTrue("Expected rejected result, got $actual", actual is WearPromptResult.Rejected)
        assertEquals(expected, (actual as WearPromptResult.Rejected).reason)
    }
}
