# BreedOps design system

Canonical visual and interaction specification for BreedOps. It applies to every page under
`/app`, to the authentication pages and to future modules. Agents and developers follow this
file rather than any tool-specific design skill. Tokens and component styles live in
`src/app/globals.css`; shared React primitives live in `src/components/ui.tsx`,
`src/components/icons.tsx`, `src/components/app-shell.tsx` and
`src/components/entity-inspector.tsx`. Icons are a single family, **Lucide React**, mapped
to semantic names in `Icon`/`IconName` (`icons.tsx`); components reference the semantic
name (`trait`, `module`, `cross`, `zoomIn`, …), never a Lucide component directly, so the
icon set stays consistent and swappable in one place.

## 1. Direction

Scientific, botanical, precise, calm, data-oriented. BreedOps should feel like research
instrumentation for plant breeding: dense but legible data, restrained colour, strong
typographic hierarchy, borders instead of shadows.

Avoid: generic admin dashboards, stacks of white cards, giant empty panels, decorative
gradients or charts, pill-shaped everything, colour used without meaning, invented data.

## 2. Tokens (`:root` in `globals.css`)

Only reference tokens from component CSS. Never hard-code a new colour in a component.

| Group | Tokens | Use |
| --- | --- | --- |
| Surfaces | `--canvas`, `--surface`, `--surface-raised`, `--surface-sunken` | page background, panels, hover rows, inputs/segmented controls |
| Borders | `--border`, `--border-subtle`, `--border-strong` | panel edges, row separators, inputs |
| Text | `--text`, `--text-secondary`, `--text-muted`, `--text-inverse` | primary, descriptions, metadata/labels, on dark |
| Brand | `--primary` (deep forest), `--primary-hover`, `--primary-soft` | primary buttons, avatar, parent lines |
| Semantic | `--teal`, `--botanical`, `--info`, `--warning`, `--danger`, `--success` (+ `-soft`) | focus/links, success/active, information, attention, destructive/error |
| Lifecycle | `--archived`, `--archived-soft` | archived records (always with a dashed border) |
| Entity kinds | `--kind-parent`, `--kind-cross`, `--kind-family`, `--kind-lot` | pedigree nodes, kind badges, inspector accent |
| Type | `--font-sans` (system stack), `--font-mono`, `--text-xs` 11px … `--text-2xl` 24px | no external font dependency |
| Spacing | `--space-1` 4px … `--space-10` 40px | 4px grid only |
| Shape | `--radius-sm` 4px, `--radius` 6px, `--radius-lg` 8px | never larger; no pills except avatars/step markers |
| Depth | `--shadow-sm`, `--shadow-overlay` | overlay shadow only for menus, popovers and the inspector |

## 3. Typography

| Role | Style |
| --- | --- |
| Page title (`h1`) | 24px, weight 650, tight tracking |
| Section title (`h2`) | 16px, weight 650 |
| Card/form title (`h3`) | 14px, weight 650 |
| Body, tables | 14px |
| Labels, metadata | 13px, `--text-secondary` / `--text-muted` |
| Eyebrows, table headers, section labels | 11px, uppercase, 0.06–0.08em tracking |
| BreedOps codes and identifiers | `--font-mono`, tabular numerals (`.code`, `.entity-code`) |
| Numbers in tables/metrics | tabular numerals (`.num`), right-aligned in tables |

## 4. Application shell

`AppShell` (client) renders:

- **Sidebar** (dark forest): brand mark + team, navigation grouped as *Pilotage*
  (Vue d’ensemble), *Sélection* (Programme, Pedigree, Phénotypes), *Laboratoire*
  (Inventaire, Opérations), *Administration* (Utilisateurs, admins only). Icons come from
  `Icon`. The active link has `aria-current="page"`. A collapse control
  (`--sidebar-width` 232px ↔ `--sidebar-collapsed` 64px) persists its state in
  `localStorage` (icons-only when collapsed; labels return on hover/focus).
- **Top bar** (sticky): active-programme selector (button + popover listing every team
  programme, current one checked), notification slot, theme toggle (`ThemeToggle`,
  sun/moon), user menu (initials, name, role label, email, team, *Mon profil*,
  *Administration* when authorised, *Déconnexion*).
- Below 960px the sidebar becomes an off-canvas drawer opened by *Ouvrir la navigation*.

The layout loads the caller’s programmes (RLS-scoped) so the header mirrors the page’s
programme fallback. Nav links and the programme switch use plain `<a href>`/document
navigation, not client-side route transitions: forms mutate through Server Actions and
reload the current route on success, so document navigation keeps every page consistent
and avoids stale client-router state (agend TD-003).

**Programme labels are always name-first.** Everywhere a programme is shown as a selector,
chip or context value (`AppShell`'s top-bar selector, `ProgramSwitch`, `ProgramContext`),
the programme **name** is the primary, high-contrast label; its business code is secondary
(muted, smaller, mono). Never show a bare technical code as the only visible label. A
`system_admin` sees every team's programmes in these same selectors (by design); when more
than one team is actually present, each entry also carries its team name so a programme
from another team never reads as an unexplained duplicate of one you already know.

## 5. Page composition

Every page follows the same order:

```
Breadcrumbs
PageHeader (eyebrow · title · one-sentence description · primary/contextual actions)
ProgramContext (compact strip) and ProgramSwitch (only when >1 programme)
Summary metrics when relevant (MetricCard grid, real values only)
Main content (registers, rankings, graph)
Secondary content (creation/configuration forms)
```

Primitives (`ui.tsx`): `PageHeader`, `SectionHeader`, `Breadcrumbs`, `ProgramContext`,
`ProgramSwitch`, `Card` (`.flush` for tables), `MetricCard` (`attention` for warnings),
`DataTable`, `StatusBadge`, `DecisionBadge`, `KindBadge`, `ActionMenu`, `EmptyState`,
`ErrorState`, `PageNotice`.

## 6. Registers and tables

- Data first: `.register-layout` puts the table (wide) beside its creation form (340px);
  it stacks below 1200px.
- First column: the BreedOps code in mono (`strong.code`); human name/descriptor next;
  counts and quantities right-aligned with tabular numerals.
- Rows representing a record are `EntityTableRow`: click, Enter or Space opens the
  inspector; the last cell is the `⋯` `ActionMenu` (*Voir le détail*, *Voir le pedigree*,
  *Archiver/Restaurer*). Controls inside rows never trigger row activation.
- Archived rows: muted text, archived badge (dashed) and a left archived bar.
- Toolbar: one search across registers and an *Actifs / Avec archives* segmented filter.
  Add filters only when real data makes them useful.
- Every table has an empty state; a filtered empty state says what was searched.

## 7. Forms

- Group related fields (`fieldset.form-section` + `legend`); short related fields share a
  row (`.fields-2`, `.fields-3`, inputs aligned to the baseline).
- Required fields carry the native `required` attribute; the label shows a discreet
  *requis* marker automatically. Do not write “requis” in label text.
- System-generated identifiers are announced with `.generated-code-hint`, never typed.
- Disabled forms explain why (`.form-hint.blocked`) and a prerequisite banner links to the
  missing step.
- `ActionForm` shows typed success/error messages; Zod field errors mark controls with
  `aria-invalid` and list the affected labels. Never display raw database errors.
- Primary submit buttons are left-aligned at natural width.
- Creation and configuration forms live in `FormDrawer` (a native `<dialog>` opened with
  `showModal()`): a labelled trigger button opens a right-hand panel holding the form, so
  registers never carry a permanently visible creation form. Use a plain inline `Card` +
  `ActionForm` instead only for the one primary action of a workspace tab (e.g. the
  evaluation form on **Phénotypes → Évaluations**).

## 8. Badges and semantic states

| Meaning | Component |
| --- | --- |
| Record status (active, planned, completed, cancelled) | `StatusBadge` with French label |
| Archived | `StatusBadge tone="archived"` / dashed border |
| Selection decision | `DecisionBadge`: Elite (botanical), Advance (teal), Reserve (amber), Eliminate (red) |
| Entity kind | `KindBadge`: square parent, diamond cross, circle family, bar lot |
| Inventory alerts | danger for expired/<30 days, warning for <90 days or below threshold |

Badges are small (11px, 4px radius). Colour always has a text label; kind badges also differ
by shape.

## 9. Entity inspector (canonical record view)

One shared inspector (`EntityInspectorWorkspace` + `EntityInspector`) serves registers and
the pedigree. Data comes from `buildBreedingEntityDetails` (`src/lib/breeding-entity-details.ts`),
which only reads persisted values; derived business values (yield, germination rate, scores,
decisions) come from PostgreSQL.

Structure:

1. **Header**: kind eyebrow in the kind colour, mono code, human title, status/archived and
   generation badges, close button; a 3px kind-coloured top accent.
2. **Action bar** (sticky): *Voir dans le pedigree*, *Modifier* (active records), *Archiver /
   Restaurer*.
3. **Body** sections separated by hairlines, not cards: *Aperçu*, *Lignée* (summary plus
   relation chips; archived ancestors dashed), propagation (*Pollinisation et récolte* or
   *Semences*), *Phénotypage et sélection* (count, evaluated, latest score, per-phenotype
   decisions, or “Pas encore de données phénotypiques.”), *Images* (see §10), *Notes*.
4. **Edit mode** replaces nothing: it inserts a form at the top (parent provenance fields,
   cross status/notes, family/lot notes).

Interaction: right sheet `clamp(420px, 34vw, 520px)` on desktop/tablet, bottom sheet at
≤640px; portaled to `<body>`; focus moves to the close button and returns to the opener;
Escape and backdrop close it. The underlying register or graph stays visible.

## 10. Media gallery and viewer

The *Images* section of the entity inspector (parent lines, families, seed lots; not
crosses) and the phenotype evaluation "Photos" drawer trigger both render the same
`MediaGallery` component (`src/components/media-gallery.tsx`): a responsive thumbnail grid
(`.media-grid`), a star badge (`primary` icon) on the active primary image, a dashed
*Afficher les archives* / *Masquer les archives* toggle, and an *Ajouter une image*
`FormDrawer` with a client-side preview, caption, type, capture date and "Définir comme
image principale" checkbox before upload. Per-item actions (*Modifier*, set primary,
*Archiver*/*Restaurer*) sit directly under each tile rather than behind an `ActionMenu`,
since a tile already has room for them.

Clicking a thumbnail opens a `.media-viewer` — a centred native `<dialog>` lightbox with a
close button, previous/next controls when more than one image is loaded, and the caption
below the image. It is the first dialog nested inside another dialog (the entity inspector's
own `<aside role="dialog">`): both it and `FormDrawer` stop an Escape keydown from
propagating past their own `<dialog>` element, so closing the nested one never also closes
its host. Any future drawer or viewer opened from inside an existing dialog should do the
same.

### 10.1 Advanced scientific metadata and annotations (V2-03)

Upload and Edit share one `AcquisitionMetadataFields` block: capture date plus an optional
time (grouped as one "Date et heure de prise de vue" field pair), developmental stage
(free text), viewpoint and imaging modality (both `<select>`s from a fixed option list),
an operator `<select>` populated from the owning team's profiles via
`useOperatorCandidates()`, scale value/unit/note, and a scientific note textarea. Every
field stays optional; nothing here replaces the V1 caption/type/capture-date trio, it only
extends the same drawer.

The viewer (`.media-viewer`) now shows a metadata `<dl>` under the image whenever any
advanced field is set, and an `.media-viewer-image-wrap` that wraps the `<img>` so
percentage-based annotation coordinates line up with the rendered image despite
`object-fit: contain`. An **Annoter** toggle reveals `AddAnnotationForm`: a type selector
(point/rectangle/text), a click-to-place surface over a copy of the image (existing
annotations shown for context), and a collapsible "Saisir les coordonnées précisément
(clavier)" fallback with plain numeric x/y/width/height inputs — the fully
keyboard-operable path, since click-to-place alone would exclude keyboard-only and screen
reader use. Every annotation also renders as a plain-text list item
(`AnnotationList`/`ArchivedAnnotationList`) alongside its overlay mark, so position and
label are always available without relying on hover, colour or pointer position. A
show/hide toggle controls the overlay only; the textual list stays visible regardless.

A new **Chronologie et comparaison** button opens `MediaTimelineDrawer`: a chronologically
ordered list (per the rule in `docs/database.md`) with a checkbox per item, feeding a
`ComparisonPanel` of up to two side-by-side `ComparisonSide` panels (image + its full
metadata table). The grid (`.media-comparison-grid`) stacks to one column below 720px
instead of overflowing. This drawer fetches its data lazily on open, not on gallery mount,
to avoid an extra query on every page that embeds a gallery.

## 11. Pedigree

Four labelled columns (lignées → croisements → familles → lots). Nodes are white with a 4px
kind-coloured accent bar, a kind icon (`plant`/`cross`/`family`/`lot` from the shared Lucide
set — leaf, merge, network, package), mono code and a kind · generation · name line.
Selected nodes get a tinted fill and kind-coloured outline; related edges turn teal while
unrelated nodes/edges fade. Archived nodes use the archived fill and a dashed outline. A
legend sits above the dotted canvas. Toolbar controls (`Zoom +`, `Zoom −`, `Ajuster la vue`)
are icon buttons with an `aria-label` carrying the same text so the accessible name is
unchanged. Nodes are keyboard focusable (Enter / Space, with `preventDefault`) and open the
shared inspector.

## 12. Responsiveness

Targets: 1440px (reference), 1024px (laptop/tablet landscape), 768px (drawer navigation,
single-column grids), 390px (inspector bottom sheet). No horizontal page overflow; wide
tables scroll inside `DataTable`.

## 13. Accessibility

Visible `:focus-visible` ring (teal), labelled controls, semantic buttons/links,
`aria-current` for navigation and segmented filters, `role="dialog"` + `aria-modal` for the
inspector, text equivalents for colour and shape, reduced motion respected.

## 14. Dark theme

Light and dark share the same semantic tokens; dark redefines them under
`:root[data-theme="dark"]` in `globals.css` (deep forest/charcoal surfaces, muted
teal/botanical accents, high-contrast text, no neon glow). `ThemeToggle` (top bar) flips
`document.documentElement.dataset.theme` and persists the choice to `localStorage`; there is
no system-preference auto-switch. Components must only reference tokens (never a literal
colour) so both themes stay correct automatically.

## 15. Configurable phenotyping screens

**Phénotypes** is a workspace with sub-navigation (`Vue d’ensemble`, `Bibliothèque de
traits`, `Modules`, `Configuration du programme`, `Évaluations`, `Classement`), each tab a
plain anchor (`tabHref`) so the active tab survives a reload. Trait library and module
cards use the same `Card`/`DataTable` primitives as registers; creating a trait or module
opens a `FormDrawer`. The module builder lists a module’s traits in order with
*Monter*/*Descendre* icon buttons (`up`/`down`) instead of drag-and-drop. Program setup
shows one card per visible module with an *Activer*/*Désactiver* `ActionForm` and a
`StatusBadge` (*Suivi par le programme* / *Non suivi*). The evaluation form
(`MeasureRow`/`MeasureProgress`) is generated from the program’s active traits grouped by
module (`fieldset.measure-group`); each row’s accessible label is the trait name plus type
and range chips, and the control (`number`/`select`/date input) is chosen from the trait’s
`data_type`, never hard-coded.

**Bibliothèque de traits** and **Modules** carry an extra **Équipe** column/badge, shown
only when the traits or modules fetched span more than one `organization_id` (always true
for a `system_admin` who can see several teams, never true for an ordinary single-team
view). Without it, two teams' independently-created "Sélection V1" module or "Architecture"
trait are visually indistinguishable from one duplicated row; the team label is the fix,
not hiding or merging the rows.

## 16. Data honesty

Show only stored or PostgreSQL-computed values. No fictitious analytics, traits, images or
decorative charts. Missing values render as “—”; empty collections use an explicit empty
state.

## 17. Operations: tabs, filters and the Gantt

**Opérations** follows the same sub-navigation pattern as Phénotypage (section 15): plain
anchors (`buildHref`), `Vue d’ensemble`/`Tâches`/`Calendrier`/`Gantt`/`Modèles`, so the
active tab and every filter survive a reload. One shared `OperationsFilterBar` (a plain
`method="get"` form) backs Tâches, Calendrier and Gantt alike — cycle/zone/responsible/
state/priority are never implemented twice. The task detail is a `FormDrawer` opened from
an **Ouvrir** trigger, never a second, disconnected page; it shows status, a derived
readiness badge (*Prête* / *En attente d’une dépendance*, never persisted), dependencies as
plain text (predecessor title, status, due date, lag), the SOP checklist and two save
actions — a plain field save, and a date save explicitly labelled **Enregistrer et
recalculer les dépendances**.

The template builder (**Modèles**) reuses *Monter*/*Descendre* icon buttons for step order,
the same pattern as the phenotyping module builder — never drag-and-drop. Dependencies
between steps are a predecessor/successor pair plus a lag, not a node-graph editor. The
schedule preview is a plain table rendered from a `start` query param with no client state;
**Créer le cycle** is a normal `ActionForm`, not a separate confirmation flow.

The Gantt is a CSS-grid/SVG timeline, not a charting library: sticky task labels on the
left (`gantt-labels`), a horizontally-scrolling date axis and bars on the right
(`gantt-scroll`/`gantt-chart`), an "Aujourd’hui" marker, and dependency connectors drawn as
one SVG `<path>` per edge (`gantt-dependencies`). A bar's colour is one of the existing
`StatusBadge` tones (`status-not_started`/`in_progress`/`blocked`/`completed`/`cancelled`
classes mapped to `--info`/`--danger`/`--success`/`--archived`), never a new palette; an
overdue bar additionally gets a `--danger` ring. Every bar carries a full accessible name
(title, dates, responsible, status, priority, dependencies) via `role="img"` and a visually
hidden text node — the SVG connectors are a visual aid, not the only place dependency
information exists. Horizontal scrolling is intentional and confined to the Gantt's own
`gantt-scroll` region; every other view must still fit its viewport with no page-level
horizontal scroll down to 768px (`.section-block > *` and `.page > *` both carry
`min-width: 0` so a wide table scrolls within its own `.table-wrap`, never the page).

## 18. Dashboard charts and the seed lot / equipment badges

`src/components/charts.tsx`'s `DistributionChart` (Recharts, the project's first actual
use of that long-pinned dependency) is the only chart component: a horizontal bar chart
whose bar colours are literal `var(--teal|--botanical|--warning|--danger|--archived)`
references, never a separate chart palette, so every bar already matches the tone of the
matching `StatusBadge`/`DecisionBadge` elsewhere and follows dark/light mode automatically.
Every chart is paired with a visible `<ul>` legend of the same label/value pairs directly
underneath it (`.chart-legend`) — satisfying PROMPT.md §11's accessible-alternative
requirement with real markup, not a hover-only tooltip — and renders `EmptyState` instead
of an empty plot when every value is zero.

Seed lots get their own `SeedLotStatusBadge` (`available`→success, `quarantined`→warning,
`depleted`→danger), never reusing the generic `LifecycleBadge` shared by parent_lines/
crosses/families: a seed lot's operational status is a different axis from that shared
active/cancelled status, and conflating the two tone mappings would misrepresent one or
the other. `DecisionBadge` gained an optional `eliminationReasons` prop: when a decision is
`eliminate` because of a failing eliminatory criterion, the badge grows a second, visible
muted-text line naming the criterion, its value and its threshold, in every one of the
three places a phenotyping decision is shown (overview, evaluation history, ranking table)
— a high `normalized_score` next to a red "Eliminate" badge is never left to speak for
itself.

Equipment reuses the existing Inventory page's layout and `FormDrawer`/`ActionForm`
conventions rather than a new page or visual language; its own `operational_status` tones
(`operational`→success, `maintenance`→warning, `out_of_service`→danger) are a local label
map, kept separate from every other status vocabulary in the app on purpose, since none of
them describe the same real-world states.

## 19. Trait analytics (`/app/analytics`)

A new top-level nav entry under "Sélection" (alongside Programme/Pedigree/Phénotypes —
analytics is phenotyping-derived and program-scoped the same way), not a tab bolted onto
the already-large Phénotypes page. Unlike `MediaGallery` (V2-03), this page is a plain
Server Component reading `searchParams` — there is no client-side `useEffect` fetch
gating its content, so every filter (trait, date range, block, location, replicate,
archived-inclusion) is a native `<form method="get">`, fully keyboard- and
headless-HTTP-reachable, with no JavaScript required to see a result.

Reuses the existing primitives throughout: `PageHeader`, `Card`, `DataTable`,
`StatusBadge`, `ProgramContext`/`ProgramSwitch`, `EmptyState`/`ErrorState`, and the
`ActionForm`/`FormDrawer` action-state conventions for the one real mutation on the page
("Enregistrer cette analyse", which inserts an `analytics_runs` row). No isolated visual
language was introduced.

Three new chart primitives in `src/components/analytics-charts.tsx`, all Recharts (like
`DistributionChart`) plus one dependency-free SVG box plot (Recharts has no native
boxplot), all using the same semantic CSS tokens so they already match dark/light mode and
every existing badge's palette:

- `HistogramChart` — pre-binned bar chart, paired with a visible `<table>` of the same
  bin/count pairs (the accessible text equivalent, same convention as `chart-legend`
  elsewhere).
- `BoxPlot` — min/Q1/median/Q3/max as a labelled SVG box-and-whisker; its `aria-label`
  spells out all five numbers, and the same numbers are already shown in the descriptive
  statistics panel next to it.
- `TrajectoryChart` — a population median line with a Q1-Q3 band, plus up to 25
  individually-coloured (and capped) entity lines on top. This is the *only* way multiple
  entities' trajectories are ever drawn simultaneously — never hundreds of raw lines (task
  requirement: avoid an unreadable "spaghetti plot"). A `<table>` of the per-date n/median/
  Q1/Q3 sits underneath.
- `AssociationScatter` — a single labelled scatter plot for one trait pair, kept but not
  wired into the current associations table (which already has paired-n/r/rho/q in tabular
  form); available for a future per-pair detail view.

Every eligibility result renders through one shared pattern: `.eligibility-panel.eligible`
(teal, matches `--teal-soft`) or `.eligibility-panel.not-estimable` (warning amber,
`--warning-soft`), each showing its own diagnostics or every missing-requirement reason as
plain visible `<ul>` text — never a disabled button with no explanation. Three warning
levels (`.analysis-warning.info|caution|not_estimable`) use the same semantic
info/warning/danger tokens as `StatusBadge`, never an arbitrary colour.

Responsive: the filters form and every `stat-grid`/comparison grid collapse to a single
column below 720px (`@media (max-width: 720px)` in `globals.css`), the same breakpoint
convention `media-comparison-grid` (V2-03) already uses.
