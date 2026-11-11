// A circles app for the round 4 phase 1b adversaries: the adversary
// controller from _circles.ts with no bug, given a LocalSend that sends
// each operation from a timer, after the input event's handler returns.

import type { AppMakers } from "../driver.ts";
import { makeTestCircles } from "./_circles.ts";

export function makeTimerSendCircles(): AppMakers["app"] {
  const app = makeTestCircles();
  return (parts) => app({ ...parts, localSend: (content) => void setTimeout(() => parts.localSend(content), 0) });
}
