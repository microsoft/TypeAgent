# Session 2 - Query exclusion and a still-unresolved handoff

Recorded synthetic exploration, not a finished guide or execution authority.

Evidence availability is distinct from occurrence time. References use stable record IDs.


## Record S04-dream-query-exclusion

Classification: fact

Occurred at: 2026-10-05T11:00:00Z

Recorded / known at: 2026-10-05T11:00:00Z




The reporting query completed outside the slow checkout trace intervals; zero affected traces contained it. Repeating the expensive-query approach did not explain the incident.




## Record S04-dream-query-cleared

Classification: correction

Occurred at: 2026-10-05T11:05:00Z

Recorded / known at: 2026-10-05T11:05:00Z




The reporting-query hypothesis is rejected for this incident because its execution did not correlate with affected traces. This does not mean expensive queries can never cause latency.




## Record S04-dream-no-blocking

Classification: fact

Occurred at: 2026-10-05T11:10:00Z

Recorded / known at: 2026-10-05T11:10:00Z




No sustained blocking or deadlock correlated with the affected window. Server CPU and blocking evidence did not support a scale-first response.




## Record S04-dream-defer-scale

Classification: decision

Occurred at: 2026-10-05T11:15:00Z

Recorded / known at: 2026-10-05T11:15:00Z




Database scale-up was deferred, not attempted. The handoff requested separate connection-acquisition and SQL-execution spans; the cause and recovery were still unknown.
