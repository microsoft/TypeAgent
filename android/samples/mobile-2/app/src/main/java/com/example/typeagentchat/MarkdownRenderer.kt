package com.example.typeagentchat

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.Heading
import org.commonmark.node.HardLineBreak
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text as MarkdownTextNode
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser
import java.net.URI

@Composable
internal fun ChatMessageText(
    text: String,
    format: MessageFormat,
    color: Color,
    style: TextStyle
) {
    if (format == MessageFormat.MARKDOWN) {
        val annotated = remember(text) { markdownToAnnotatedString(text) }
        Text(
            text = annotated,
            color = color,
            style = style
        )
    } else {
        Text(
            text = text,
            color = color,
            style = style
        )
    }
}

internal fun markdownToAnnotatedString(markdown: String): AnnotatedString {
    val document = Parser.builder().build().parse(markdown)
    return MarkdownAnnotatedStringRenderer().render(document)
}

internal fun sanitizeMarkdownUri(destination: String?): String? {
    if (destination.isNullOrBlank()) {
        return null
    }

    return try {
        val uri = URI(destination)
        when (uri.scheme?.lowercase()) {
            "http", "https", "mailto", "tel" -> destination
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

private class MarkdownAnnotatedStringRenderer {
    private val builder = AnnotatedString.Builder()
    private val listStack = mutableListOf<ListContext>()

    fun render(document: Node): AnnotatedString {
        renderChildren(document)
        return trimTrailingWhitespace(builder.toAnnotatedString())
    }

    private fun renderChildren(parent: Node) {
        var child = parent.firstChild
        while (child != null) {
            renderNode(child)
            child = child.next
        }
    }

    private fun renderNode(node: Node) {
        when (node) {
            is Paragraph -> {
                renderInlineChildren(node)
                appendBlockBreak()
            }

            is Heading -> {
                val start = builder.length
                renderInlineChildren(node)
                builder.addStyle(
                    SpanStyle(fontWeight = FontWeight.Bold),
                    start,
                    builder.length
                )
                appendBlockBreak()
            }

            is BulletList -> renderBulletList(node)
            is OrderedList -> renderOrderedList(node)
            is FencedCodeBlock -> renderCodeBlock(node.literal)
            is IndentedCodeBlock -> renderCodeBlock(node.literal)

            is BlockQuote -> {
                appendPrefixedText("> ", collectPlainText(node).trim())
                appendBlockBreak()
            }

            is HtmlBlock -> {
                builder.append(node.literal)
                appendBlockBreak()
            }

            is ThematicBreak -> {
                builder.append("----------")
                appendBlockBreak()
            }

            else -> renderChildren(node)
        }
    }

    private fun renderBulletList(list: BulletList) {
        listStack += ListContext(ordered = false, nextIndex = 1)
        renderListItems(list)
        listStack.removeAt(listStack.lastIndex)
        if (listStack.isEmpty()) {
            appendBlockBreak()
        }
    }

    private fun renderOrderedList(list: OrderedList) {
        listStack += ListContext(ordered = true, nextIndex = list.startNumber)
        renderListItems(list)
        listStack.removeAt(listStack.lastIndex)
        if (listStack.isEmpty()) {
            appendBlockBreak()
        }
    }

    private fun renderListItems(list: Node) {
        var child = list.firstChild
        while (child != null) {
            renderListItem(child as ListItem)
            child = child.next
        }
    }

    private fun renderListItem(item: ListItem) {
        val context = listStack.last()
        val indent = "  ".repeat(listStack.size - 1)
        val prefix = if (context.ordered) {
            "${context.nextIndex}. "
        } else {
            "• "
        }
        context.nextIndex += 1

        builder.append(indent)
        builder.append(prefix)

        var child = item.firstChild
        var renderedAnyContent = false
        while (child != null) {
            when (child) {
                is Paragraph -> {
                    renderInlineChildren(child)
                    renderedAnyContent = true
                }

                is BulletList -> {
                    if (renderedAnyContent) {
                        builder.append('\n')
                    }
                    renderBulletList(child)
                }

                is OrderedList -> {
                    if (renderedAnyContent) {
                        builder.append('\n')
                    }
                    renderOrderedList(child)
                }

                else -> {
                    if (renderedAnyContent) {
                        builder.append('\n')
                        builder.append(indent)
                        builder.append("  ")
                    }
                    renderNode(child)
                    renderedAnyContent = true
                }
            }
            child = child.next
        }

        if (!endsWithNewline()) {
            builder.append('\n')
        }
    }

    private fun renderInlineChildren(parent: Node) {
        var child = parent.firstChild
        while (child != null) {
            renderInlineNode(child)
            child = child.next
        }
    }

    private fun renderInlineNode(node: Node) {
        when (node) {
            is MarkdownTextNode -> builder.append(node.literal)
            is SoftLineBreak, is HardLineBreak -> builder.append('\n')

            is Emphasis -> renderStyledNode(node, SpanStyle(fontStyle = FontStyle.Italic))

            is StrongEmphasis -> renderStyledNode(node, SpanStyle(fontWeight = FontWeight.Bold))

            is Code -> {
                val start = builder.length
                builder.append(node.literal)
                builder.addStyle(
                    SpanStyle(fontFamily = FontFamily.Monospace),
                    start,
                    builder.length
                )
            }

            is Link -> renderLink(node)
            is Image -> builder.append(renderImageLabel(node))
            is HtmlInline -> builder.append(node.literal)
            else -> renderInlineChildren(node)
        }
    }

    private fun renderStyledNode(node: Node, style: SpanStyle) {
        val start = builder.length
        renderInlineChildren(node)
        builder.addStyle(style, start, builder.length)
    }

    private fun renderLink(link: Link) {
        val start = builder.length
        renderInlineChildren(link)
        val end = builder.length
        if (end > start) {
            builder.addStyle(
                SpanStyle(
                    fontWeight = FontWeight.Medium,
                    textDecoration = TextDecoration.Underline
                ),
                start,
                end
            )
        }

        val safeDestination = sanitizeMarkdownUri(link.destination)
        val label = builder.toString().substring(start, end)
        if (!safeDestination.isNullOrBlank() && label != safeDestination) {
            builder.append(" (")
            builder.append(safeDestination)
            builder.append(')')
        }
    }

    private fun renderCodeBlock(code: String) {
        val start = builder.length
        builder.append(code.trimEnd('\n'))
        builder.addStyle(
            SpanStyle(fontFamily = FontFamily.Monospace),
            start,
            builder.length
        )
        appendBlockBreak()
    }

    private fun appendPrefixedText(prefix: String, text: String) {
        if (text.isBlank()) {
            return
        }
        val lines = text.lines()
        lines.forEachIndexed { index, line ->
            if (index > 0) {
                builder.append('\n')
            }
            builder.append(prefix)
            builder.append(line)
        }
    }

    private fun appendBlockBreak() {
        if (builder.length == 0) {
            return
        }
        if (!endsWithNewline()) {
            builder.append('\n')
        }
        if (!builder.toString().endsWith("\n\n")) {
            builder.append('\n')
        }
    }

    private fun endsWithNewline(): Boolean {
        return builder.length > 0 && builder.toString().last() == '\n'
    }

    private fun renderImageLabel(image: Image): String {
        val altText = collectPlainText(image).ifBlank { "image" }
        return "[Image: $altText]"
    }

    private fun collectPlainText(node: Node): String {
        val collected = StringBuilder()

        fun collect(current: Node?) {
            var child = current
            while (child != null) {
                when (child) {
                    is MarkdownTextNode -> collected.append(child.literal)
                    is SoftLineBreak, is HardLineBreak -> collected.append('\n')
                    is Code -> collected.append(child.literal)
                    is HtmlInline -> collected.append(child.literal)
                    is HtmlBlock -> collected.append(child.literal)
                }
                collect(child.firstChild)
                child = child.next
            }
        }

        collect(node.firstChild)
        return collected.toString()
    }

    private data class ListContext(
        val ordered: Boolean,
        var nextIndex: Int
    )
}

private fun trimTrailingWhitespace(value: AnnotatedString): AnnotatedString {
    var end = value.length
    while (end > 0 && value.text[end - 1].isWhitespace()) {
        end -= 1
    }
    return if (end == value.length) value else value.subSequence(0, end)
}
