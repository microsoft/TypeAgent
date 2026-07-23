# Mobile 2 - TypeAgent Android Chat Sample

This sample shows a minimal Android Jetpack Compose chat client that connects to a local TypeAgent agent-server over WebSocket.

## What this sample demonstrates

- Jetpack Compose chat UI (message history, input, send button, connection status)
- OkHttp WebSocket usage on Android
- TypeAgent agent-server protocol handling:
  - `joinConversation`
  - `submitCommand`
  - inbound `appendDisplay`, `setDisplayInfo`, and command completion events
- Incremental assistant streaming into a single chat bubble per `requestId`

## Prerequisites

- Android Studio (recent stable version)
- Android emulator
- A running TypeAgent agent-server on your host machine at `ws://localhost:8999`

## Run the TypeAgent server

From your TypeAgent workspace:

```powershell
pnpm run start:agent-server
```

## Run the Android sample

1. Open this folder in Android Studio: `android/samples/mobile-2`
2. Let Gradle sync finish.
3. Start an Android emulator.
4. Run the `app` module.

The app connects to:

```text
ws://10.0.2.2:8999
```

`10.0.2.2` is the Android emulator alias for your host machine's localhost.

## Notes

- Cleartext WebSocket (`ws://`) is enabled for local development in this sample.
- If you test on a physical device, update the WebSocket URL in `WebSocketManager.kt` to your machine's LAN IP (for example `ws://192.168.1.10:8999`).
