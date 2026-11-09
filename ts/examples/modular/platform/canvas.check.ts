// Checks that the platform's own types fit the subsets cut from them. This
// folder compiles with the DOM library; the rest of the repo compiles
// without it, so implementations can't reach the browser except through a
// subset. npm run typecheck runs both.
import type { DrawingContext } from "../canvas.ts";

const browser = null as unknown as CanvasRenderingContext2D;
const offscreen = null as unknown as OffscreenCanvasRenderingContext2D;
export const fits: DrawingContext[] = [browser, offscreen];
