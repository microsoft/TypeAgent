# Suggestions for createTopSongsPlaylist Recipe

## Current Limitations

1. **Unstructured Search Results**: The `utility.webSearch` action returns plain text snippets, requiring an LLM query step to parse song titles and artists. This adds latency and potential errors.

2. **No Dedicated Music Charts API**: The flow relies on general web search to find top songs, which may return inconsistent formats across different music chart websites.

## Potential Improvements

1. **Add Music Charts Action**: Create a dedicated action that queries music chart APIs (Billboard, Spotify Charts, etc.) directly and returns structured JSON with song data:

   ```typescript
   {
     actionName: "getMusicCharts",
     parameters: {
       genre: string,
       quantity: number,
       timePeriod: string,
       chartSource?: "spotify" | "billboard" | "appleMusic"
     }
   }
   ```

   This would eliminate the query step entirely and provide more reliable data.

2. **Enhance webSearch Output**: Add optional structured output to webSearch when it detects music-related queries, automatically parsing song lists from known chart websites.

3. **Validation Step**: Add a step to verify that songs found actually exist on Spotify before attempting to create the playlist (using `player.searchTracks`).
