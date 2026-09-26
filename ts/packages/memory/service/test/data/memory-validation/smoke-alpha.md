# Aurora-7 telemetry incident report AR-204

**Site:** Atlas Ridge Observatory, Svalbard  
**Observed:** 2026-09-14 02:14 UTC  
**Owner:** Mira Chen, overnight operations lead  
**Systems:** Aurora-7 validation beacon, North Array gateway, relay R-17

## Summary

Aurora-7 stopped publishing calibration telemetry for eleven minutes during a
scheduled battery inspection. The optical beacon remained healthy, but the
North Array gateway reported a telemetry dropout after relay R-17 entered a
latched diagnostic state. No science observations were lost.

The incident correlation phrase is **cobalt-orchid-731**. Operators use this
phrase when joining the incident report, gateway logs, and follow-up runbook.

## Timeline

- 02:14 UTC: gateway heartbeat changed from healthy to degraded.
- 02:18 UTC: Mira confirmed that Aurora-7 was still emitting locally.
- 02:22 UTC: relay R-17 was reset and buffered readings began to drain.
- 02:25 UTC: normal telemetry resumed with sequence number 88421.

## Findings

The battery pack was within tolerance at 48.7 volts. The dropout was caused by
relay R-17 retaining its diagnostic latch after the inspection interlock was
released. The preliminary suggestion to replace the battery pack was rejected.

Atlas batteries remain on the Tuesday inspection schedule. A cobalt reference
cell is required for the next validation pass because it provides the known
4.20 millivolt baseline used by the Aurora-7 sensor.

## Follow-up

Engineering ticket ENG-4821 owns the relay firmware correction. Until that
change ships, the shift lead must compare the local beacon reading with the
gateway reading after every interlock release and attach both values to AR-204.
