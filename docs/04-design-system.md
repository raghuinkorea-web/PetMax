# Design system

The rules the two applications are built from, and the reasoning behind the
decisions that were not obvious.

---

## Brand

| | |
|---|---|
| Company | **ADISYS Technologies** · adisystech.com |
| Tagline | *Observation Driven Insights* |
| Product | **ADISYS FieldOps** |

### The wordmark

`Wordmark` renders the official ADISYS artwork, which ships in each app's
`public/` directory:

| File | Size | Used when |
|---|---|---|
| `adisys-logo.png` | 500 × 128 | the full lockup, wordmark above the tagline |
| `adisys-wordmark.png` | 410 × 75 | `showTagline={false}` — too short to carry the tagline |

Both are transparent PNGs. `height` is the same figure the earlier drawn mark
took: the full lockup renders at `height × 1.35` so it occupies the space the
layouts were built around, and without the tagline `height` is the height of
the lettering itself.

The artwork is brand red above a near-black tagline, which would disappear on
the dark `ink-900` panels. `variant="mono-light"` therefore knocks the whole
mark out to white with `filter: brightness(0) invert(1)` — the same all-white
treatment the drawn mark used on dark surfaces.

**To substitute different artwork**, set `VITE_BRAND_LOGO_URL` and
`VITE_BRAND_WORDMARK_URL`. `BrandMark` is a separate drawn square mark and is
unaffected.

---

## Colour

### The decision that shapes everything else

ADISYS red is a *red*. Red is also the universal colour of failure. Using one
red for both would mean a page could not distinguish "this is ADISYS" from
"this went wrong".

So the palette is split, and the split is enforced by naming:

- **Brand red** is reserved for ADISYS identity, the single primary action on a
  screen, and the active navigation indicator. Nothing else.
- **Status colours** carry operational meaning. They are deliberately
  desaturated and darker than the brand, so they read as information rather
  than as branding.

Focus rings are **graphite**, not brand red, for the same reason: on a form
where the error state is red, a red focus ring reads as "you got this wrong"
rather than "you are here".

### Tokens

Every token is declared in `@theme`, so each one is a real Tailwind utility
(`bg-card`, `text-danger`, `ring-line`, `rounded-card`, `shadow-raised`).
There are no ad-hoc hex values in component code.

| Group | Tokens |
|---|---|
| Brand | `brand-50 … brand-900`, primary `#E3131B` |
| Graphite | `ink-50 … ink-950`, primary text `#12161C` |
| Surfaces | `surface` `#F4F6F8` · `card` `#FFFFFF` · `sunken` `#EEF1F4` |
| Lines | `line` `#E4E8ED` · `line-strong` `#CFD6DE` |
| Status | `success` `#06703F` · `warning` `#96590A` · `info` `#1A55BD` · `progress` `#0B6C86` · `danger` `#AD2027` · `muted` `#55606E`, each with a `-soft` background |

### Status tone mapping

A status maps to a tone once, in `packages/shared/src/domain.ts`, and every
badge, dot and chart in both applications reads from it.

| Tone | Used for |
|---|---|
| `neutral` | Draft, cancelled, inactive |
| `info` | Acknowledged, submitted, invited |
| `progress` | In progress, under review, awaiting payment |
| `warning` | Acknowledgement pending, returned |
| `success` | Completed, approved, paid, verified |
| `danger` | Rejected, needs clarification, suspended |

---

## Chart palette

Chart colour was **computed, not chosen**. The palette was run through a
colour-vision validator against the white card surface and passes:

| Check | Result |
|---|---|
| Lightness band | PASS — all slots inside L 0.43–0.77 |
| Chroma floor | PASS |
| Adjacent-pair CVD separation | PASS — worst ΔE 9.1 (protan) |
| Normal-vision floor | PASS — worst ΔE 22.9 |
| Contrast vs surface | WARN on two slots → **relief rule applied** |

Because two slots sit below 3:1 contrast, every chart that uses them ships a
legend **and** a *View as table* toggle. That table is the accessible
equivalent of the plot, not a nicety.

| Role | Token | Hex |
|---|---|---|
| Recorded / assigned | `--color-chart-1` | `#2A78D6` |
| Verified / approved / completed | `--color-chart-3` | `#1BAF7A` |
| Pending | `--color-chart-4` | `#EDA100` |
| Rejected | `--color-chart-rejected` | `#AD2027` |
| Categorical slots 2, 5, 6, 7 | `--color-chart-2/5/6/7` | `#EB6834` `#E87BA4` `#008300` `#4A3AA7` |

**Rules held to throughout**: colour follows the entity and never its rank;
categorical hues are assigned in fixed order and never cycled; no dual-axis
chart exists anywhere in the product; grid lines are horizontal only and
recessive; bars carry a 4px rounded data end; lines are 2px with no per-point
dots.

---

## Typography

Inter, with a full system fallback stack so the apps remain legible if the font
cannot load in the field.

| Use | Size / weight |
|---|---|
| Page title | 18px / 600 |
| Section heading | 14px / 600 |
| Body | 14px / 400 (mobile inputs 16px) |
| Secondary | 12px / 400 |
| Micro (timestamps, hints) | 11px / 400 |
| KPI figure | 24px / 600, tabular |

**Every figure in a table or KPI uses `font-variant-numeric: tabular-nums`**,
so columns of rupees and hours align on the decimal point.

Mobile inputs are 16px specifically: anything smaller makes iOS Safari zoom the
viewport on focus, which is disorienting on a phone held in one hand.

---

## Layout and spacing

- 4px base unit; components step 8 / 12 / 16 / 20 / 24.
- Cards: `rounded-card` (10px) on desktop, `rounded-2xl` (16px) on mobile —
  larger radii read as "touchable".
- Elevation is functional, not decorative: `shadow-card` at rest,
  `shadow-raised` on interactive hover, `shadow-overlay` for modals and sheets.
- Admin content is capped at the viewport with internal scroll, so navigation
  and page header stay put during long lists.
- Mobile content is capped at `max-w-lg` and centred, so the app looks
  deliberate on a tablet rather than stretched.

---

## Components

Both applications share the same component vocabulary, adapted per platform.

| Component | Admin | Employee |
|---|---|---|
| Overlay | Centred `Modal` | Bottom `Sheet`, thumb-reachable |
| Choice | `Select` | `OptionGrid` — large tap targets, works with gloves |
| Tabs | Underlined `Tabs` | Pill `SegmentedControl`, horizontally scrollable |
| Feedback | Toasts bottom-right | Toasts top, clear of the thumb |
| Table | `DataTable` with sort, selection, pagination | Cards |

### Every interactive state is built

Loading (skeletons shaped like the content they replace), empty (explaining what
would appear and offering the action that creates it), error (the server's
message plus a retry and a request reference), validation (inline, per field,
from the server's own response), success (a toast that says what happened next),
and disabled (with the reason stated next to the control, not hidden in a
tooltip).

---

## Accessibility

- Every form control is nested inside its `<label>`, so the association cannot
  drift.
- One visible focus treatment, never suppressed.
- Status is never colour alone: every badge carries text, and the dot is
  decorative.
- Charts have a table equivalent and a text legend.
- Touch targets are at least 44px in the field app.
- `prefers-reduced-motion` disables all animation.
- `prefers-contrast: more` lifts line and secondary text contrast — field staff
  work in bright sunlight.
- Icons that carry meaning have accessible names; decorative ones are
  `aria-hidden`.

---

## Writing

The interface explains rather than labels.

| Instead of | The product says |
|---|---|
| "Acknowledged" | "Acknowledging confirms you have received and read the work. It does not mark it complete." |
| "Invalid" | "This would take your food total for 18 Sept to ₹1,100, above the ₹600 daily limit (₹400 already claimed)." |
| "Error 403" | "This claim belongs to another manager's project or team." |
| "Productive hours" | plus a tooltip: "Recorded hours a manager has explicitly verified. This is the only figure ADISYS reports as productive hours." |

Error messages name the thing that is wrong and the action that fixes it.
Numbers carry their definition wherever they are shown.
