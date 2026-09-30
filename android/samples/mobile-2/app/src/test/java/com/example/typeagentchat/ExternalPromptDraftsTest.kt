package com.example.typeagentchat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalPromptDraftsTest {

    @Test
    fun `parked prompts keep their boundaries`() {
        val drafts = ExternalPromptDrafts()

        val first = drafts.park("", "first prompt")
        val stillFirst = drafts.park(first, "second prompt")
        val second = drafts.currentRemoved("")
        val empty = drafts.currentRemoved("")

        assertEquals("first prompt", first)
        assertEquals("first prompt", stillFirst)
        assertEquals("second prompt", second)
        assertEquals("", empty)
        assertFalse(drafts.isShowingExternalPrompt)
    }

    @Test
    fun `external prompt waits behind an existing draft`() {
        val drafts = ExternalPromptDrafts()

        val existing = drafts.park("phone draft", "watch prompt")
        assertEquals("phone draft", existing)
        assertFalse(drafts.isShowingExternalPrompt)

        val watchPrompt = drafts.currentRemoved("")
        assertEquals("watch prompt", watchPrompt)
        assertTrue(drafts.isShowingExternalPrompt)
    }

    @Test
    fun `edited external prompt remains marked and clearing advances the queue`() {
        val drafts = ExternalPromptDrafts()

        drafts.park("", "watch prompt")

        assertEquals("edited watch prompt", drafts.park("edited watch prompt", "next prompt"))
        assertTrue(drafts.isShowingExternalPrompt)
        assertEquals("next prompt", drafts.currentRemoved(""))
        assertTrue(drafts.isShowingExternalPrompt)
    }
}
