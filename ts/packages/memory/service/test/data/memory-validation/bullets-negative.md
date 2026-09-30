# Aurora-7 diagnostic field notes

These notes summarize observations from AR-204. They are deliberately not an
approved runbook: ordering depends on the live gateway state, and an operator
must use OPS-A7-12 for an executable calibration procedure.

## Troubleshooting observations

- A degraded heartbeat can coexist with a healthy local optical beacon.
- Relay R-17 exposes its diagnostic latch in the North Array status payload.
- Sequence number 88421 is the first packet confirmed after recovery.
- Engineering ticket ENG-4821 contains the proposed firmware correction.

The bullets are reference facts, not ordered instructions. They must remain a
negative procedure-detection control even though the heading sounds actionable.
