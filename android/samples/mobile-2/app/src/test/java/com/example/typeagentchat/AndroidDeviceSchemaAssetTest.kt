package com.example.typeagentchat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the schema asset that is shipped in the APK and sent to the server at
 * registration.
 *
 * Both failure modes this covers are silent at runtime. A construct the
 * server's TypeScript schema parser cannot read fails the whole schema, not
 * just the offending action, and registration still succeeds - the agent simply
 * ends up disabled and requests fall through to the chat agent. An action name
 * that no longer matches the Kotlin dispatcher only shows up as an error at the
 * moment a user asks for it.
 */
class AndroidDeviceSchemaAssetTest {

    private val schema: String by lazy { readSchemaAsset() }

    @Test
    fun `no parenthesised union is used as an array element type`() {
        // `( "a" | "b" )[]` is legal TypeScript but the server's schema parser
        // rejects it with "Unhandled type node ParenthesizedType", and because
        // parsing is all or nothing that disables every action in the file.
        // Name the union instead, the way AlarmRepeatDay does.
        val parenthesisedArray = Regex("""\)\s*\[\s*]""")
        val offending = schema.lines()
            .withIndex()
            .filter { (_, line) -> parenthesisedArray.containsMatchIn(line) }
            .map { (index, line) -> "line ${index + 1}: ${line.trim()}" }

        assertTrue(
            "The server's schema parser cannot read a parenthesised type used as " +
                "an array element; extract a named type alias instead. Found at " +
                offending.joinToString("; "),
            offending.isEmpty()
        )
    }

    @Test
    fun `every action the schema declares is handled by the dispatcher`() {
        val declaredActions = declaredActionNames()
        assertFalse("No actionName literals were found in the schema", declaredActions.isEmpty())

        val unhandled = declaredActions.filter { !isHandledByAgent(it) }

        assertTrue(
            "AndroidDeviceAgent.parseExecuteAction does not handle $unhandled, so the " +
                "server would translate those requests and the device would reject them",
            unhandled.isEmpty()
        )
    }

    @Test
    fun `the action union lists every action type exactly once`() {
        val unionMembers = Regex("""export type AndroidDeviceAction =([^;]*);""")
            .find(schema)
            ?.groupValues
            ?.get(1)
            ?.split("|")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            .orEmpty()
        val declaredTypes = Regex("""export type (\w+Action) = \{""")
            .findAll(schema)
            .map { it.groupValues[1] }
            .toList()

        // Without this both lists can end up empty - a reformat of the type
        // declarations alone would do it - and the comparison below would then
        // pass while checking nothing at all.
        assertFalse(
            "No action type declarations were matched, so this test is not " +
                "actually checking the schema any more",
            declaredTypes.isEmpty()
        )
        assertEquals(
            "Every action type must appear in the AndroidDeviceAction union, or the " +
                "server never offers it",
            declaredTypes.sorted(),
            unionMembers.sorted()
        )
        assertEquals(
            "An action type is listed in the union more than once",
            unionMembers.size,
            unionMembers.toSet().size
        )
    }

    @Test
    fun `the alarm repeat days match the day names the parser accepts`() {
        val schemaDays = Regex("""export type AlarmRepeatDay =([^;]*);""")
            .find(schema)
            ?.groupValues
            ?.get(1)
            ?.split("|")
            ?.map { it.trim().trim('"') }
            ?.filter { it.isNotEmpty() }
            .orEmpty()

        assertEquals(7, schemaDays.size)
        // A day the schema offers but the parser does not know fails the whole
        // setAlarm action, so the two lists have to stay in step.
        val rejected = schemaDays.filter { !isAlarmDayAccepted(it) }
        assertTrue("AlarmActionParser rejects the day names $rejected", rejected.isEmpty())
    }

    private fun isAlarmDayAccepted(day: String): Boolean {
        val parameters = JSONObject()
            .put("originalRequest", "wake me up")
            .put("time", "06:45")
            .put("days", JSONArray().put(day))
        return parseSetAlarmActionPayload(parameters) != null
    }

    private fun declaredActionNames(): List<String> =
        Regex("""actionName:\s*"([^"]+)"""")
            .findAll(schema)
            .map { it.groupValues[1] }
            .toList()

    /**
     * Sends the action name through the real dispatcher. Empty parameters make
     * most actions fail validation, which is fine: only the "unsupported"
     * branch means the name is not wired up at all.
     */
    private fun isHandledByAgent(actionName: String): Boolean {
        val action = JSONObject()
            .put("actionName", actionName)
            .put("parameters", JSONObject())
        val args = JSONArray().put(JSONObject().put("action", action))

        val parsed = AndroidDeviceAgent.parseExecuteAction(args)
        return !(parsed is AndroidDeviceActionParseResult.ActionError &&
            parsed.message.startsWith("Unsupported Android agent action"))
    }

    private fun readSchemaAsset(): String {
        // Unit tests run with the module directory as the working directory,
        // but do not depend on that: walk up until the assets tree appears.
        var directory: File? = File(".").absoluteFile
        while (directory != null) {
            val candidate = File(directory, "app/src/main/assets/${AndroidDeviceAgent.SCHEMA_ASSET}")
            if (candidate.isFile) return candidate.readText()
            val moduleLocal = File(directory, "src/main/assets/${AndroidDeviceAgent.SCHEMA_ASSET}")
            if (moduleLocal.isFile) return moduleLocal.readText()
            directory = directory.parentFile
        }
        throw AssertionError(
            "Could not find ${AndroidDeviceAgent.SCHEMA_ASSET} from ${File(".").absolutePath}"
        )
    }
}
