# Brief: "Rhombus Analytics" Landing Page

Build a single-file landing page for a fictional product called **Rhombus Analytics**.
The whole page should be self-contained in this directory (no frameworks, no CDN links,
no network access at runtime).

## Deliverables

Three files, colocated in this directory:

| File         | Purpose                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html` | Page structure. Must reference `style.css` and `script.js`, embed the logo from `assets/logo.svg` (inline SVG or `<img>`), and include the headline, subhead, primary CTA button, and feature grid described below. |
| `style.css`  | Applies every color, font, and spacing value from `design-tokens.json`. Uses CSS custom properties derived from those tokens. No hard-coded hex colors outside `:root`.                                             |
| `script.js`  | Attaches one click handler to the CTA button that toggles a `.cta--pressed` class on it. Logs a structured event `{ type: "cta_click", timestamp }` via `console.log`.                                              |

## Page content

- **Headline**: `Decisions, measured.`
- **Subhead**: `Rhombus Analytics turns raw event streams into decisions your team can defend.`
- **CTA button text**: `Start a free trial`
- **Feature grid** (three cards, each with a title and one-sentence description):
  1. `Realtime` — "Every event visible in under a second, even under load."
  2. `Auditable` — "Every metric traces back to the event that produced it."
  3. `Safe` — "Role-based access and tamper-proof audit logs out of the box."

## Constraints

- Read [design-tokens.json](design-tokens.json) and use every value in it. Introduce no other colors or font families.
- All three output files must pass these postconditions:
  - `index.html` contains `Decisions, measured.` and `Start a free trial`.
  - `style.css` contains `--color-primary` and the hex value from the tokens file.
  - `script.js` contains `cta_click`.
- Do **not** fetch anything from the network. The policy blocks it anyway; attempting it will produce a visible block event on the dashboard.
