# Spotify TypeAgent

## Application Keys

To turn on Spotify integration you will need additional setup with Spotify to use the Spotify API.

1. Go to https://developer.spotify.com/dashboard.
2. Log into Spotify with your user account if you are not already logged in.
3. Click the button in the upper right labeled "Create App".
4. Fill in the form, making sure the Redirect URI is `http://127.0.0.1:PORT/callback`, where `PORT` is a **_previously unused_** four-digit port number you choose for the authorization redirect.
5. Click the settings button and copy down the Client ID and Client Secret (the client secret requires you to click 'View client secret').
6. In your `config.local.yaml`, set the Spotify credentials under the `spotify` section (see `config.sample.yaml`):
   ```yaml
   spotify:
     clientId: <your-client-id>
     clientSecret: <your-client-secret>
     port: <PORT> # must match the redirect URI you registered in step 4
   ```
   The legacy `.env` file is also still supported: set `SPOTIFY_APP_CLI` to your Client ID, `SPOTIFY_APP_CLISEC` to your Client Secret, and `SPOTIFY_APP_PORT` to the port from step 4.
7. While your Spotify app is in [Development Mode](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), open the app's **User Management** page on the dashboard and add the Spotify account(s) that will use the integration. Accounts that are not on this allowlist will get `403 Forbidden` from most Web API endpoints.

> [!NOTE]
> Several Web API endpoints (playback control, playlist read/write, the Web Playback SDK) require a Spotify **Premium** account. Free accounts can sign in but most actions will fail.

## Music Player Spotify Integration

The `player` agent (package name `music`) implements Spotify support. Enable it like any other agent, then do a one-time OAuth login:

1. Enable the agent: `@config agent player on`
2. Authenticate: `@player spotify login` — this opens the browser for a one-time authorization. Afterward, the refresh token is stored (DPAPI-encrypted on Windows, Keychain on macOS, libsecret on Linux via `@azure/msal-node-extensions`) at `$(HOME)/.typeagent/profiles/<profile>/player/token`, so subsequent runs mint access tokens without prompting.
3. (Optional) Load Spotify listening history: `@player spotify load <path-to-history-file>`
4. To clear the cached token: `@player spotify logout`
5. To disable the agent entirely: `@config agent player off`

To actually hear audio, an active Spotify client must be running and signed in as the same user (the Spotify desktop app, mobile app, or any browser tab on `open.spotify.com`) — the agent controls playback on whichever device Spotify reports as active.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
