package com.example.typeagentchat

import org.junit.Assert.assertEquals
import org.junit.Test

class ConfirmationParserTest {
    @Test
    fun `accepts yes inputs`() {
        assertEquals(true, parseYesNoInput("Y"))
        assertEquals(true, parseYesNoInput(" yes "))
    }

    @Test
    fun `accepts no inputs`() {
        assertEquals(false, parseYesNoInput("N"))
        assertEquals(false, parseYesNoInput(" no "))
    }

    @Test
    fun `rejects non confirmation input`() {
        assertEquals(null, parseYesNoInput("weather"))
    }

    @Test
    fun `parses one-based choice index`() {
        assertEquals(0, parseSingleChoiceIndex("1", 3))
        assertEquals(2, parseSingleChoiceIndex(" 3 ", 3))
    }

    @Test
    fun `rejects invalid choice index`() {
        assertEquals(null, parseSingleChoiceIndex("0", 3))
        assertEquals(null, parseSingleChoiceIndex("4", 3))
        assertEquals(null, parseSingleChoiceIndex("x", 3))
    }
}
