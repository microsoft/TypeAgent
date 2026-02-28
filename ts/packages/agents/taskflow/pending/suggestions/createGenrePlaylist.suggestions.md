# createGenrePlaylist Recipe - Suggestions

## Recipe Details

- **Action Name**: `createGenrePlaylist`
- **Purpose**: Create a playlist with top songs from a specified music genre
- **Data Source**: Roots Music Report (https://www.rootsmusicreport.com/charts/view/song/genre/{genre}/weekly)

## URL Pattern Discovery

Successfully identified a stable, parameterizable URL pattern:

- Pattern: `https://www.rootsmusicreport.com/charts/view/song/genre/${genre}/weekly`
- Tested genres: bluegrass, country, folk
- Content: Server-side rendered HTML with song rankings, titles, and artists
- Space normalization: Automatic hyphenation works (e.g., "alternative rock" → "alternative-rock")

## Observations

### Player Schema - createPlaylist Action

The `createPlaylist` action accepts a `songs` parameter of type `SongSpecification[]`:

```typescript
interface SongSpecification {
  trackName: string;
  artist?: string;
  albumName?: string;
}
```

**Current behavior**: Returns plain text confirmation message

**Potential improvement**: If the action returned structured JSON output with details about:

- Which songs were successfully found and added
- Which songs couldn't be found
- Final playlist URL or ID

Then follow-up flows could check success rate and potentially retry failed songs or provide feedback to the user.

### Alternative Data Sources

Other chart sources discovered (for reference):

- **Bluegrass Today Monthly**: https://bluegrasstoday.com/monthly-chart/ (bluegrass-specific, monthly)
- **PopVortex**: https://www.popvortex.com/music/charts/top-{genre}-songs.php (iTunes charts)
- **Billboard**: https://www.billboard.com/charts/{genre}-albums/ (album charts)

The Roots Music Report was chosen because:

1. Clear URL parameterization by genre
2. Server-side rendered content (no JS required)
3. Weekly updates (most current data)
4. Consistent structure across genres

## Performance Comparison

- **Fast path** (webFetch + llmTransform): ~5-7 seconds
- **Claude path** (claudeTask): ~30-40 seconds
- **Recommendation**: Use fast path for production

## Testing Notes

- Test with multiple genres: bluegrass, country, folk, americana, rock
- Test with different quantities: 5, 10, 20, 50
- Test with custom playlist names and auto-generated names
- Verify space-to-hyphen normalization for multi-word genres
