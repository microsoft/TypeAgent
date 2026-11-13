Status: reviewed

Phase 2b review of task 11's second run, second attempt (`alternates/circle.run-2.ts`, Sonnet), sent back by phase 3 for computed emptiness. Drafted by the design agent.

## Choices

- **open** A plain object with closures.
- **respecify** `intersects` and `contains` compare squared distances, where `Circle.disk` says `distToPolyline(p, [center]) <= radius` as computed, which uses `Math.hypot`. The two round differently at the boundary: sampling points on the circle found 3 disagreements in 24 (center (37.402773233408865, 38.00226293832716), radius 17.275314187141277, point (21.876258685413738, 30.42837184752447): inside by the rule, outside here). The contract skipped points within a rounding step of the radius, so it missed this. Made: a fixed case with that point, a property over points on the circle with no tie skipped, and the adversary `Circle.disk--contains-squared`. 11.2 goes back for another attempt.
- **open** The bounding-box prefilter on the stored box.
- **open** Validation order and messages.
- **open** Helper names.

## Notes

- **nothing** The three fixed cases of `Circle.exact-intersects` took the most work: the cases are what the contract is for, and the box-first check is a way to meet `Shape.intersects.implies-box`, as the 2b review of the previous attempt recorded.
