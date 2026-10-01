# Aurora-7 field calibration runbook

**Runbook:** OPS-A7-12  
**Applies to:** Aurora-7 sensor head after an interlock or relay reset  
**Approval:** Observatory controls team

Use this runbook only after the gateway heartbeat is stable. The technician
needs a cobalt reference cell, an isolated test bus, and an open maintenance
record. Stop and escalate to the shift lead if the baseline differs from 4.20
millivolts by more than 0.05 millivolts.

## How to calibrate the Aurora-7 validation sensor

1. Confirm that relay R-17 is unlatched and record the gateway sequence number.
2. Disconnect the sensor from the live bus and attach the isolated test bus.
3. Attach the cobalt reference cell and wait for three stable samples.
4. Compare the median reading with the 4.20 millivolt acceptance baseline.
5. Record the final calibration reading and both bus sequence numbers in the maintenance record.

## Expected result

The local and gateway readings agree within 0.05 millivolts, the sequence
numbers advance without a gap, and the maintenance record links to the source
incident. A failed acceptance check leaves Aurora-7 isolated.
