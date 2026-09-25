# Relay R-17 firmware release record

**Change:** ENG-4821  
**Target:** Atlas Ridge North Array gateway  
**Release owner:** Observatory controls team

This checklist gates the firmware correction for the diagnostic latch observed
in AR-204. Evidence must remain attached to the release record so another
operator can reconstruct why the change was approved.

## Pre-deployment verification checklist

- [ ] Run the focused memory service tests against an isolated data root.
- [ ] Verify that the Aurora-7 runbook cites the active AR-204 source revision.
- [ ] Publish the signed relay firmware to the Atlas staging gateway.
- [ ] Confirm that a simulated interlock release clears the R-17 diagnostic latch.
- [x] Record the validation commit and test transcript in ENG-4821.

Deployment is blocked while any unchecked item lacks evidence. Production
rollout requires the Atlas shift lead and controls engineer to approve the same
release record.
