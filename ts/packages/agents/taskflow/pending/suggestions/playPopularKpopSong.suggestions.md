# Suggestions for playPopularKpopSong Flow

## Current Limitations

1. **Chart Granularity**: Most K-pop chart sites (Melon, Billboard Korea, Only Hits) publish weekly charts rather than monthly charts. The flow currently uses the "this week" chart as a proxy for "this month". This is acceptable since weekly charts reflect current popularity, but users asking for "this month" will actually get "this week's" top song.

2. **Time Period Parameter**: The `timePeriod` parameter is currently not used in the webFetch URL because:
   - Only Hits chart URL pattern requires specific week numbers (e.g., `/kpop-2026-09`)
   - Translating user inputs like "this month", "last month", "January" to week numbers would require date arithmetic
   - The stable URL `/charts/kpop-thisweek/` always returns the current week

   **Potential improvement**: Add date arithmetic in a preprocessing step to calculate the appropriate week number from natural language time periods, then use the week-specific URL pattern `https://onlyhit.us/en/charts/kpop-{year}-{week}`.

3. **Player Action Output Format**: The `playTrack` action returns plain text status messages rather than structured JSON. This is fine for the end of a flow, but if we wanted to chain additional actions (e.g., "play the top K-pop song and add it to my favorites"), having JSON output would be helpful.

## Source Selection Rationale

**Chosen source**: Only Hits K-pop Charts (`onlyhit.us/charts/kpop-thisweek/`)

**Why this source**:
- Server-side rendered HTML (works with webFetch)
- Stable URL pattern that doesn't require authentication
- Reliable weekly updates
- Clear chart structure with song title and artist

**Alternatives considered**:
- Billboard Korea Hot 100: Client-side rendered (JavaScript required)
- Melon Chart: Client-side rendered, requires regional access
- Spotify playlists: Not a true chart, just curated playlists

## Testing Notes

When compiling, test with:
- "get the most popular kpop song this month and play it"
- "play the top kpop song this week"
- "find the hottest kpop song right now and play it"

Expected behavior: Should fetch current chart, extract #1 song (as of March 2026, this would be "BANG BANG" by IVE), and play it via Spotify.
