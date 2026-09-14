# Wear OS Sample

This sample recognizes a spoken prompt and sends it to the
[`mobile-2`](../mobile-2/) TypeAgent chat app on a paired phone. The phone owns
the TypeAgent connection; the watch is a thin input peripheral.

## Run the POC

1. Configure and run the `mobile-2` sample on the paired phone.
2. Open this folder in Android Studio and run the `app` module on a Wear OS 3+
   device or emulator paired with that phone.
3. Tap the speech-to-text button, speak a prompt, and confirm it in the system
   recognizer.

The watch displays whether Android accepted the remote launch. TypeAgent's
response is shown on the phone; this POC has no response path back to the watch.

The phone accepts `typeagentchat://main` links and auto-executes them by default
for controlled POC testing. `RemoteActivityHelper` requires a browsable link,
which is not an authentication boundary. For production, use the Wear Data
Layer or disable phone-side auto-execution with
`-Ptypeagent.wear.autoexecute=false`.