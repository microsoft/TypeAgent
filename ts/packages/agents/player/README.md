# Spotify TypeAgent

## Application Keys

To turn on Spotify integration you will need additional setup with Spotify to use the Spotify API.

1. Go to https://developer.spotify.com/dashboard.
2. Log into Spotify with your user account if you are not already logged in.
3. Click the button in the upper right labeled "Create App".
4. Fill in the form, making sure the Redirect URI is http://127.0.0.1:PORT/callback, where PORT is a **_previously unused_** four-digit port number you choose for the authorization redirect.
5. Click the settings button and copy down the Client ID and Client Secret (the client secret requires you to click 'View client secret').
6. In your `.env` file, set `SPOTIFY_APP_CLI` to your Client ID and `SPOTIFY_APP_CLISEC` to your Client Secret. Also set `SPOTIFY_APP_PORT` to the PORT on your local machine that you chose in step 4.

## Music Player Spotify Integration

To turn on Spotify in the shell or interactive mode, run `@config spotify on`. There will be an one time authorization with the browser for the new app to access your account. Afterward, refresh token will be store in `$(HOME)/.typeagent/profiles/<profile>/player/token.json` to get the access token again without prompting.

You can use `@config spotify off`, to turn off running the action.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
