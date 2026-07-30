package com.example.typeagentchat

import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownRendererTest {
    @Test
    fun `renders headings and ordered lists as readable text`() {
        val rendered = markdownToAnnotatedString("### Lists\n1. first\n2. second")

        assertTrue(rendered.text.contains("Lists"))
        assertTrue(rendered.text.contains("1. first"))
        assertTrue(rendered.text.contains("2. second"))
        assertTrue(rendered.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
    }

    @Test
    fun `keeps raw html literal and drops unsafe link targets`() {
        val rendered = markdownToAnnotatedString("<script>alert(1)</script>\n[bad](javascript:alert(1))")

        assertTrue(rendered.text.contains("<script>alert(1)</script>"))
        assertTrue(rendered.text.contains("bad"))
        assertFalse(rendered.text.contains("javascript:alert(1)"))
    }

    @Test
    fun `allows safe link destinations`() {
        assertEquals("https://example.com", sanitizeMarkdownUri("https://example.com"))
        assertEquals("mailto:test@example.com", sanitizeMarkdownUri("mailto:test@example.com"))
        assertEquals(null, sanitizeMarkdownUri("javascript:alert(1)"))
    }
}
