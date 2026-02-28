# createTopPlaylist Recipe Suggestions

## Current Implementation

- Fast path: webFetch → llmTransform → createPlaylist (~5s)
- Comparison: single claudeTask (~35s)

## Potential Improvements

### 1. Genre Normalization

**Issue:** PopVortex URL pattern requires specific genre names (e.g., "hip-hop" vs "hiphop", "r&b" vs "rnb")
**Suggestion:** Add genre normalization mapping in the flow compiler or create a utility action to map common genre variations to PopVortex's expected format
**Examples needed:**

- hip hop → hip-hop
- r&b/rnb → r-b (need to verify actual URL)
- electronic/edm → ? (check if supported)

### 2. Error Handling for Invalid Genres

**Issue:** If user requests unsupported genre, webFetch will return 404 or wrong page
**Suggestion:** Consider pre-validation step or graceful fallback to webSearch approach

### 3. Chart Date Awareness

**Issue:** "this month" is static text; doesn't adapt to actual chart date
**Suggestion:** Consider extracting the chart date from the page and using it in playlist name for accuracy

### 4. Alternative Chart Sources

**Notes for robustness:**

- Billboard charts could be secondary source if PopVortex is unavailable
- Spotify's own chart API (if available via search) might give better song matching
- Current solution relies on iTunes chart data which may differ from Spotify's catalog

## Testing Notes

When compiling, test with:

- Standard genres: country, rock, pop, jazz
- Multi-word genres: hip-hop, r-b
- Various quantities: 5, 10, 20, 50
- Edge cases: quantity > 100 (PopVortex shows top 100)
