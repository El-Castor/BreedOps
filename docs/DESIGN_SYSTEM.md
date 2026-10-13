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
   decisions, or “Pas encore de données phénotypiques.”), *Images* (empty boundary with a
   disabled future action), *Notes*.
4. **Edit mode** replaces nothing: it inserts a form at the top (parent provenance fields,
   cross status/notes, family/lot notes).

Interaction: right sheet `clamp(420px, 34vw, 520px)` on desktop/tablet, bottom sheet at
≤640px; portaled to `<body>`; focus moves to the close button and returns to the opener;
Escape and backdrop close it. The underlying register or graph stays visible.

## 10. Pedigree

Four labelled columns (lignées → croisements → familles → lots). Nodes are white with a 4px
kind-coloured accent bar, a kind icon (`plant`/`cross`/`family`/`lot` from the shared Lucide
set — leaf, merge, network, package), mono code and a kind · generation · name line.
Selected nodes get a tinted fill and kind-coloured outline; related edges turn teal while
unrelated nodes/edges fade. Archived nodes use the archived fill and a dashed outline. A
legend sits above the dotted canvas. Toolbar controls (`Zoom +`, `Zoom −`, `Ajuster la vue`)
are icon buttons with an `aria-label` carrying the same text so the accessible name is
unchanged. Nodes are keyboard focusable (Enter / Space, with `preventDefault`) and open the
shared inspector.

## 11. Responsiveness

Targets: 1440px (reference), 1024px (laptop/tablet landscape), 768px (drawer navigation,
single-column grids), 390px (inspector bottom sheet). No horizontal page overflow; wide
tables scroll inside `DataTable`.

## 12. Accessibility

Visible `:focus-visible` ring (teal), labelled controls, semantic buttons/links,
`aria-current` for navigation and segmented filters, `role="dialog"` + `aria-modal` for the
inspector, text equivalents for colour and shape, reduced motion respected.

## 13. Dark theme

Light and dark share the same semantic tokens; dark redefines them under
`:root[data-theme="dark"]` in `globals.css` (deep forest/charcoal surfaces, muted
teal/botanical accents, high-contrast text, no neon glow). `ThemeToggle` (top bar) flips
`document.documentElement.dataset.theme` and persists the choice to `localStorage`; there is
no system-preference auto-switch. Components must only reference tokens (never a literal
colour) so both themes stay correct automatically.

## 14. Configurable phenotyping screens

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

## 15. Data honesty

Show only stored or PostgreSQL-computed values. No fictitious analytics, traits, images or
decorative charts. Missing values render as “—”; empty collections use an explicit empty
state.
