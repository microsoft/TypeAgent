package com.example.typeagentchat

import org.json.JSONObject
import java.net.URI
import java.net.URISyntaxException

internal data class OpenWebPageAction(
    val originalRequest: String,
    val url: String
)

/**
 * URLs are longer than the other free-text fields, but a cap still applies so an
 * unbounded string cannot reach the binder transaction.
 */
private const val MAX_URL_CHARS = 2_048

/**
 * The only schemes this action will ever launch.
 *
 * This is the load-bearing check. `Intent.ACTION_VIEW` will happily follow any
 * scheme a deep link has claimed - `market:`, a bank app's own scheme, or a
 * `file:` URI - so accepting a scheme from the model would turn a "show me this
 * page" action into an arbitrary-app launcher driven by whatever text the model
 * last read. Prompt injection makes that reachable from ordinary content, so the
 * allowlist is closed rather than a denylist.
 */
private val allowedSchemes = setOf("http", "https")

/**
 * Parses the `parameters` of the `openWebPage` action declared by
 * `androidDeviceSchema.ts`:
 *
 * ```ts
 * parameters: { originalRequest: string; url: string }
 * ```
 *
 * Android 12+ routes generic web intents to the default browser rather than
 * letting an arbitrary app claim them, which is a further backstop - but not one
 * to rely on, since it does not apply below API 31.
 */
internal fun parseOpenWebPageActionPayload(data: Any?): OpenWebPageAction? {
    val payload = data as? JSONObject ?: return null
    // Only the surrounding whitespace is trimmed. Stripping it *inside* the URL
    // would turn "https://exa mple.com" into a perfectly valid address for a
    // host the model never named, so an interior space is treated as a broken
    // URL and refused - the model is told, rather than the user being sent
    // somewhere plausible-looking.
    val raw = payload.optActionString("url").trim()
    if (raw.isEmpty() || raw.length > MAX_URL_CHARS || raw.any { it.isWhitespace() }) {
        return null
    }
    val url = normalizeWebUrl(raw) ?: return null

    return OpenWebPageAction(
        originalRequest = payload.sanitizedActionText("originalRequest"),
        url = url
    )
}

/**
 * Validates [url] and returns it with the scheme lower-cased, or null if it is
 * not an absolute `http`/`https` URL with a host.
 *
 * The lower-casing is not cosmetic. Intent filter scheme matching is
 * case-sensitive, and the manifest `<queries>` entries declare lowercase
 * `http`/`https`, so `HTTPS://example.com` would resolve to nothing and be
 * reported as "No browser is available on this device." - the misleading
 * `resolveActivity` null that the whole `<queries>` block exists to avoid.
 *
 * Parsed with `java.net.URI` rather than `android.net.Uri` so this stays
 * unit-testable on the JVM. `URI` is also the stricter of the two: `Uri.parse`
 * never fails, so a malformed string would sail through it.
 */
internal fun normalizeWebUrl(url: String): String? {
    val parsed = try {
        URI(url)
    } catch (_: URISyntaxException) {
        return null
    }
    val scheme = parsed.scheme?.lowercase() ?: return null
    if (scheme !in allowedSchemes) {
        return null
    }
    // Rejects "http:/example.com" and "https://" - forms that parse but have
    // nothing to open.
    if (parsed.host.isNullOrEmpty()) {
        return null
    }
    return scheme + url.substring(url.indexOf(':'))
}

/** True when [url] is an absolute `http`/`https` URL with a host. */
internal fun isSupportedWebUrl(url: String): Boolean = normalizeWebUrl(url) != null
