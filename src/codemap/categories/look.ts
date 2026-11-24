import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const look: CodeCategory = {
  id: "look",
  area: "app",
  title: "The look",
  summary: "How the portal looks: colour tokens for light and dark, the type scale, the shared marks, and the look an admin sets in Admin › Theming. The default look is the designer's palette (Ocean, Sky, Snow, Midnight, Sun, Earth, Grain, Land, Berry) in Roboto; the token blocks of `styles.css` hold exactly what `src/lib/theme.ts` works out for it. `marks.tsx` and `controls.css` draw what every page shows the same way (kind tag, level, fact, the paths' pictures, tabs, segments). The server keeps only what the admin chose (`portal_settings`); `theme.ts` works out every colour from it, readable in both themes, and sets it as CSS custom properties that the token blocks read, with the default look as fallback.",
  requirements: [
    "Every colour that follows the brand or a state goes through a token: `--accent` (text, links, outlines), `--accent-fill` with `--accent-ink`, `--action-fill` / `--action-ink` (the one main button), `--action-other*`, `--good` / `--warn` / `--bad` / `--info` with `-bg`, `-fill`, `-ink`, `--kind-process-*`, `--kind-standard-*`, the ground (`--bg`, `--surface*`, `--line*`, `--text*`, `--seg-on`, `--control-line`, `--bar*`), the tints `--ocean-10/35/75/100` and `--sky-10/35/75/100`, `--highlight`, `--search-mark`, `--quiet*`, the marks `--mark-green/brown/sky` (with `-bg`), the map's `--step-*` and `--lane-*`, and `--font-family`. A literal colour there would ignore Theming.",
    "Only what the admin chose is stored (`portal_settings`, key `theme`); every derived colour is worked out in the browser by `derive()`, so an improved rule applies to every stored look without a migration, and an installation that chose colours keeps them.",
    "Worked-out text aims at `TEXT_MIN` (4.7:1), a margin over 4.5:1 so that a hover tint or a half-transparent ground still passes, on every surface of each theme (the raised `--seg-on` and the brand's 10 % tint included), only by making a colour lighter or darker (`readable()`); buttons and states in the dark theme must also read on the dark editing bar. Outlines of inputs, selects, text areas and chips (`--control-line`) and the map's icons on their tiles need 3:1 (`CONTROL_MIN`). `readingPairs` lists every pair a look produces; `themeDesigner.test.ts` checks them on six looks in both themes.",
    "The tints (10, 35, 75 and 100 % of Ocean, the brand, and of Sky, the second colour; over Snow in light, over the dark ground in dark) are for backgrounds, tables, lines and marks only, never for text; they follow a changed brand and second colour (`themeDesigner.test.ts` fails on a tint used as `color`).",
    "Body text has three sizes with their line heights (`--fs-sm/--lh-sm` 12/16, `--fs-md/--lh-md` 14/20, `--fs-lg/--lh-lg` 16/24) and three weights (`--fw-regular` 400, `--fw-medium` 500, `--fw-strong` 700), italic for emphasis; headings use `--fs-h4` … `--fs-display`, never the regular weight. Every font size, weight and line height in every stylesheet but `print.css`, and every inline one in the components, is one of these tokens (`typeScale.test.ts`). The type scale is not a setting of a look.",
    "A part left at its default sets no property, so the fallback in `var(--theme-light-…, default)` applies; the preview sets such parts to `initial` (`lookProperties`) so that the admin's own saved look does not leak into it. A chosen ink or second colour changes the surfaces every colour is measured on, so then every colour is worked out again.",
    "The defaults are written twice, in the token blocks of `styles.css` and in `theme.ts` (`DEFAULT_LOOK`, `groundOf`); `themeDesigner.test.ts` keeps every CSS fallback equal to `derive(DEFAULT_LOOK)`, so the warnings of Theming measure against what the page really shows.",
    "Light or dark: the person's own choice wins, then the look's appearance, then the device (`isDark`).",
    "A level (Mandatory / Must …) is drawn in neutral ink, never in the problem colour; a review that is due is a warning, an overdue one a problem. A mark that is no state (the paths' pictures, the map's lanes) is built on `--mark-*`, the kinds or the brand, never on `--good` / `--warn` / `--bad`.",
    "A chosen segment (`.seg-item.on`) is raised and outlined (`--seg-on`) with its text in `--accent`, never filled; the fill is for the one main button of a view. Search highlights use `--search-mark`, worked out from the highlight (Sun) so that text in the ordinary colour reads on it; it never follows the brand.",
    "Fonts ship with the app (`@fontsource-variable/roboto`, its italic, and `/inter`); Roboto is the default, Inter a choice; no stylesheet or font is loaded from another host.",
  ],
  charts: [
    {
      caption: "From a change in Admin › Theming to the colours in every browser. The server refuses a save made from an outdated revision, like every other save; the next page load in any browser starts with the last look it kept and then fetches the current one.",
      process: flow("code-look-save", "A look from Admin to every browser", "How a chosen look is saved and reaches everybody.",
        [["admin", "Admin"], ["browser", "Browser"], ["server", "Server"], ["postgres", "Postgres"]],
        [
          s("edit", "Choose name, logo, colours, font", "admin", "task", ["save"], "preview in both themes"),
          s("save", "Save on top of the revision", "browser", "communication", ["newer"], "PUT /api/admin/theme?rev="),
          s("newer", "Saved by someone since?", "server", "decision", [["conflict", "Yes"], ["write", "No"]]),
          s("conflict", "Refuse, keep the changes on screen", "browser", "automation", [], "409, who saved"),
          s("write", "Store only what was chosen", "postgres", "document", ["take"], "portal_settings"),
          s("take", "Use it, keep it in this browser", "browser", "automation", ["later"], "takeLook, pm:look"),
          s("later", "Fetch the look on the next load", "browser", "communication", ["apply"], "GET /api/theme, 3 s at most"),
          s("apply", "Set the tokens on the root element", "browser", "automation", [], "--theme-light-…, data-theme"),
        ]),
    },
    {
      caption: "`deriveColor` for one chosen colour in one theme. Afterwards `derive` compares the results and warns what will be mistaken for what (CIELAB distance below 25).",
      process: flow("code-look-colour", "Working out one colour", "What theme.ts does with one chosen colour, per theme.",
        [["browser", "Browser"]],
        [
          s("chosen", "Take the chosen colour", "browser", "task", ["reads"], "#rrggbb"),
          s("reads", "Readable on every surface?", "browser", "decision", [["soft", "Yes"], ["move", "No"]], "4.7:1, groundOf"),
          s("move", "Make it only lighter or darker", "browser", "automation", ["soft"], "readable(): same hue"),
          s("soft", "Mix the soft tint and the line", "browser", "automation", ["fills"], "with the surface"),
          s("fills", "Fill stands out from the surface?", "browser", "decision", [["fill-chosen", "Yes"], ["fill-text", "No"]], "1.4:1, FILL_MIN"),
          s("fill-chosen", "Fill with the chosen colour", "browser", "automation", ["ink"]),
          s("fill-text", "Fill with the readable variant", "browser", "automation", ["ink"]),
          s("ink", "Put white or near-black ink on it", "browser", "automation", [], "inkOn"),
        ]),
    },
  ],
  tables: [
    {
      name: "portal_settings",
      purpose: "Settings of the installation; today one row, the look of the portal (key `theme`).",
      columns: [
        { name: "key", type: "text", note: "primary key; the check allows only 'theme'" },
        { name: "value", type: "jsonb", note: "the look as chosen: name, logo (an icon id), colours as #rrggbb, appearance, font" },
        { name: "revision", type: "int", note: "1 for the first save, one more for each save; a save names the revision it was made from" },
        { name: "updated_by", type: "text", note: "email of whoever saved last" },
        { name: "updated_by_name", type: "text" },
        { name: "updated_at", type: "timestamptz" },
      ],
      keys: ["primary key (`key`)", "check (`key` in ('theme'))", "check (`revision` > 0)"],
      createdIn: "server/internal/db/migrations/010_portal_settings.sql",
      writtenBy: ["server/internal/theme/theme.go"],
      readBy: ["server/internal/httpapi/theme.go", "src/lib/theme.ts"],
      rules: [
        "Only what the admin chose is stored; derived colours never are.",
        "A save from an outdated revision is refused (`theme.Conflict`, answered as 409 with who saved).",
      ],
    },
  ],
  examples: [
    {
      title: "A yellow brand colour",
      caption: "What happens to one chosen colour on its way to the page: in the light theme it is darkened to read on white, in the dark theme it is kept.",
      stages: [
        { label: "Chosen in Admin › Theming", where: "src/components/ThemeSection.tsx", shape: "{ \"name\": \"Platform Portal\", \"brand\": \"#FDE047\" }", note: "Typed or picked; `normalizeHex` writes it in lower case." },
        { label: "Cleaned and stored", where: "src/lib/theme.ts", shape: "portal_settings: key = 'theme', value = { \"name\": \"Platform Portal\", \"brand\": \"#fde047\" }", note: "`cleanLook` keeps only valid parts; nothing derived is stored." },
        { label: "Derived for both themes", where: "src/lib/theme.ts", shape: "{\n  \"light\": { \"accent\": \"#826e01\", \"accent-fill\": \"#826e01\", \"accent-ink\": \"#ffffff\", \"accent-soft\": \"#fffced\" },\n  \"dark\":  { \"accent\": \"#fde047\", \"accent-fill\": \"#fde047\", \"accent-ink\": \"#11121c\", \"accent-soft\": \"#695f39\" }\n}", note: "On white the yellow is far below 4.7:1, so the light theme uses a dark yellow, also as the fill (the chosen fill would vanish into the surface). The Ocean tints (`--ocean-10` …) follow the new brand too." },
        { label: "Set on the root element", where: "src/lib/theme.ts", shape: "<html data-theme=\"light\" style=\"--theme-light-accent: #826e01; --theme-light-accent-fill: #826e01; … --theme-dark-accent-soft: #695f39\">", note: "`apply()` removes every property of an earlier look first." },
        { label: "Read by the token block", where: "src/styles.css", shape: "--accent: var(--theme-light-accent, #1165dc);  /* now #826e01 */", note: "Every link, outline, selected tab and the first lane of the map use `--accent`; nothing else changes." },
      ],
    },
  ],
  start: "src/styles.css",
  files: [
    {
      path: "src/styles.css",
      role: "The tokens of the light and the dark theme, the base styles, and the styles of most pages (top bar, buttons, page, map, checklist, drawer, forms, dialogs, Guide, standards, skills, admin).",
      requirements: [
        { text: "Every fallback here is what `derive(DEFAULT_LOOK)` works out for the light theme; `themeDesigner.test.ts` fails when one differs, because Theming measures contrast and likeness against `theme.ts`, not against this file.", at: ":root, .look-light {" },
        { text: "The dark block is the same derivation for the dark theme: the ground is the ink (Midnight), the surfaces the ink lifted with a little Snow (`groundOf`), also kept equal by the test. It applies on `:root[data-theme=\"dark\"]`, which only `theme.ts` sets.", at: ":root[data-theme=\"dark\"], .look-dark {" },
        { text: "`--action-other` has no default on purpose: every use writes `var(--action-other, …)` with the neutral look as fallback, so an unchosen colour leaves the other buttons neutral.", at: "--action-other: var(--theme-light-action-other);" },
        { text: "The `-on-dark` tokens read only `--theme-dark-…`: the editing bar is dark in both themes, so its colours must come from the dark set even in the light theme.", at: "--accent-on-dark:" },
        { text: "The map's colours are tokens of the look: four for the kinds of steps (`--step-work` the brand, `--step-check` the standards' colour, `--step-system` the processes' colour, `--step-plain` the second ink) and six for the lanes (`--lane-1` the brand, then marks that are never a state, in an order where neighbours differ also for people who cannot tell red from green), each with its tile (`-bg`). So Theming recolours the map with everything else.", at: "--step-work: var(--accent); --step-work-bg: var(--accent-soft);" },
        { text: "The type scale, defined once; `typeScale.test.ts` checks the values and that every stylesheet uses only these tokens.", at: "--fs-lg: 16px; --lh-lg: 24px; --fs-md: 14px; --lh-md: 20px; --fs-sm: 12px; --lh-sm: 16px;" },
        { text: "Below 1120 pixels `.topbar > .nav` is hidden and the Menu shown; the breakpoint must stay where the longest top bar (an admin with eight places) still fits (`e2e/layout.spec.ts`).", at: "@media (max-width: 1119px) {" },
      ],
      tests: ["src/lib/__tests__/themeDesigner.test.ts", "src/lib/__tests__/typeScale.test.ts", "e2e/theming.spec.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/lib/theme.ts",
      role: "The designer's palette (`DESIGNER`) and the default look; works out every colour of a look for light and dark (the ground from the ink and the second colour, the tints, the marks, the highlight and the quiet surface), warns what will be mistaken for what, and applies the look to the page.",
      requirements: [
        { text: "A colour that already passes is kept exactly; only one that fails is searched for, by lightness alone, so a chosen hue is never swapped for another.", at: "if (passes(hex)) return hex.toLowerCase();" },
        { text: "The fill keeps the chosen colour (a yellow button stays yellow with dark ink) unless it stands less than 1.4:1 off the surface; then the readable variant is the fill.", at: "const fill = [s.surface, ...also].every((b) => contrast(chosen, b) >= FILL_MIN) ? chosen.toLowerCase() : text;" },
        { text: "Worked-out text aims at 4.7:1, not 4.5:1: what is laid over a ground (a hover tint, a half-transparent pill) still passes. Lowering it brings back text under 4.5:1 on composited grounds. Test: `themeDesigner.test.ts` (worked-out text keeps a margin).", at: "export const TEXT_MIN = 4.7;" },
        { text: "Buttons and states (not the brand or the kinds) must also read on the dark editing bar in the dark theme; the bar is the ink of this look (`ground.bar`).", at: "const also = mode === \"dark\" && ![\"brand\", \"process\", \"standard\"].includes(part) ? ground.bar : [];" },
        { text: "A part that is not a valid #rrggbb produces no token, so its CSS default applies, unless a chosen ink or second colour changed the surfaces: then the default colour is worked out again on them.", at: "const emit = own || groundChosen;" },
        { text: "The ground of a look: light, Snow surfaces on Sky at 10 %; dark, the ink deepened until light text reads on it at 15:1, its surfaces lifted with a little Snow. `raised` (`--seg-on`) is what a chosen segment, tab count, chip or page number stands on, and every worked-out text must read on it too.", at: "export function groundOf(look: Pick<Look, \"secondary\" | \"ink\"> = {}): Ground {" },
        { text: "The marks that are no state (`--mark-green` from Land, `--mark-brown` from the quiet surface, `--mark-sky` from the second colour), with a 20 % tile: what the paths' pictures and the map's lanes build on, so that a mark never reads as success or a warning.", at: "function markTokens(name: string, color: string, ground: Ground): Record<Mode, Record<string, string>> {" },
        { text: "Every pair of text, icon or outline and its ground a look produces, with the contrast it needs; a new token pair belongs here, or the readability test cannot see it.", at: "export function readingPairs(t: Record<string, string>): (ReadingPair & { worked: boolean })[] {" },
        { text: "Which look token each kind of step and each lane is drawn in: the same pairs as the block in `styles.css`, so that `readingPairs` checks the map too.", at: "export const MAP_TOKENS: Record<string, [string, string]> = {" },
        { text: "A logo is used only when it is a 64-character icon id; anything else from storage or the server is ignored, so no other text ever becomes part of the logo's address.", at: "if (typeof o.logo === \"string\" && ICON_ID.test(o.logo)) out.logo = o.logo;" },
        { text: "Every property of an earlier look is removed before the new one is set, so a colour taken back to its default does not linger.", at: "for (const p of ALL_PROPERTIES) root.style.removeProperty(p);" },
        { text: "The look is fetched also before signing in (the sign-in page shows it); after 3 seconds the request is given up and the last look stays, so a slow server never keeps a new visitor on a blank page.", at: "const timer = setTimeout(() => stop?.abort(), 3000);" },
        { text: "The switch in the top bar (`pm:theme`) beats the look's appearance.", at: "if (own === \"dark\" || own === \"light\") return own === \"dark\";" },
      ],
      tests: ["src/lib/__tests__/theme.test.ts", "src/lib/__tests__/themeDesigner.test.ts", "e2e/theming.spec.ts"],
    },
    {
      path: "src/components/ThemeSection.tsx",
      role: "Admin › Theming: the name, the logo, the designer's palette by name, the colours (brand, second colour and ink; kinds; buttons; states; highlight and quiet surface), the font (Default (Roboto) or Inter) and the appearance, with a live preview in both themes.",
      requirements: [
        { text: "Saved through `useDraft` (key `theme`), like every other save: Undo, the unsaved-changes guard and the refusal of an outdated revision come with it; the server also refuses non-admins (`/api/admin/theme`).", at: "docKey: \"theme\", saved: saved.look" },
        { text: "Save asks once about the look's warnings; the same set of warnings is not asked about again, a changed set is.", at: "if (warnings > 0 && accepted.current !== said) {" },
        { text: "The preview tiles carry the edited look as element properties, so the page around them keeps the saved look until Save.", at: "style={lookProperties(look) as React.CSSProperties}" },
      ],
      tests: ["src/lib/__tests__/theme.test.ts", "e2e/theming.spec.ts"],
    },
    {
      path: "src/theme.css",
      role: "Admin › Theming (settings and preview), and the uploaded logo in the top bar and on the sign-in page.",
      requirements: [
        { text: "With a nearly grey brand colour (`data-link-lines`, set by `underlineLinks`) links are underlined; colour alone would not tell them from text.", at: ":root[data-link-lines] a:not([class])" },
      ],
    },
    {
      path: "src/controls.css",
      role: "The styles of the shared parts: kind tag, level mark, fact line, underline tabs and the segmented control.",
      requirements: [
        { text: "A chosen segment is a raised surface with an outline (`--seg-on`, `--seg-on-line`); it reads as chosen by its shape alone, also for someone who cannot tell the brand colour from grey. Its `--accent` text is worked out to read on `--seg-on` (`groundOf`'s `raised`), never made fainter with opacity.", at: ".seg-item.on { background: var(--seg-on);" },
        { text: "The level mark uses only `--text`, `--text-2`, `--text-3`: a level is a fact, never drawn as a problem.", at: ".level-mark { display: inline-flex;" },
      ],
    },
    {
      path: "src/components/marks.tsx",
      role: "The shared parts that say the same thing the same way on every page: `KindTag`, `LevelMark`, `LevelBars`, `NoLevelMark`, `Fact`, and the paths' pictures (`PathSymbolIcon`, `PathMark`, `PathMarks`, `PathRoad`, `PathAny`).",
      requirements: [
        { text: "The icon-only kind tag keeps the word as screen-reader text, so a row of a list still says Process or Standard.", at: "<Icon size={13} aria-hidden=\"true\" /><span className=\"card-kind sr-only\">{word}</span>" },
        { text: "The word of a level comes from `levelWord` (`search.ts`), the same that names the filter options.", at: "const word = levelWord(level);" },
        { text: "A path is told apart by its picture, never by colour alone, and its name is always there for a screen reader (and as the tooltip): a page never draws a path mark of its own. An unknown or missing picture is the neutral signpost.", at: "{named ? <span className=\"path-name\">{entry.name}</span> : <span className=\"sr-only\">{entry.name}</span>}" },
        { text: "A document that names no path (the usual case) gets one quiet fact, “Any path”, not a road: a road with every lane lit would look like a document made for all paths.", at: "if (!mine.length) return <PathAny kind={kind} className={className} />;" },
      ],
      tests: ["e2e/pages.spec.ts", "e2e/cards.spec.ts"],
    },
    {
      path: "src/components/Brand.tsx",
      role: "The portal's logo tile: the uploaded logo, or the default mark on the brand fill.",
      requirements: [
        { text: "The logo's address comes from `logoUrl`, versioned by the start of its id, so a new logo gets a new address and is not taken from the browser's cache.", at: "const url = src ?? logoUrl(look);" },
      ],
    },
    {
      path: "src/lib/stepMeta.ts",
      role: "The kinds of steps (label, colour token, tile, when to use) for the map, the legend and the prompts, and the colours of the lanes.",
      requirements: [
        { text: "No colour literal: every kind of step and every lane is a token (`--step-…`, `--lane-n`, each with its tile), so Theming changes the map with everything else. `themeDesigner.test.ts` fails on a literal here.", at: "export const LANE_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--lane-${n})`);" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts", "src/lib/__tests__/themeDesigner.test.ts"],
    },
    {
      path: "src/lists.css",
      role: "The lists of processes and standards and the search results: the filter panel, the cards and rows, the pages, the search box.",
      requirements: [
        { text: "A found word is marked on `--search-mark` (worked out from the highlight in `theme.ts`) with its text in the ordinary `--text`, never in a tint or the brand: a brand-coloured highlight would look like a link.", at: ".search-mark { background: var(--search-mark); color: var(--text);" },
      ],
    },
    {
      path: "src/paths.css",
      role: "The paths' pictures and \"Which path is this for\": the plate, the lanes of the road, the chips of the editing screen and the picker of Admin › Lists.",
      requirements: [
        { text: "Each picture has an ink, a plate and a line built only on tokens of the look that are no state: greenfield on `--mark-green`, brownfield on the quiet surface, the paved path on the brand and its Ocean tints, the rest neutral. Never the problem or warning colour, so a path never reads as something wrong; it follows light, dark and a changed look.", at: "--path-sprout: var(--mark-green);" },
      ],
    },
    {
      path: "src/detail.css",
      role: "The reader's pages of processes and standards: the use and feedback line, sharing, the map's extras.",
      requirements: [
        { text: "An upvote or bookmark that is on uses the brand's soft tint, not a state colour.", at: ".engage-btn.on {" },
      ],
    },
    {
      path: "src/group.css",
      role: "The page of a team, a platform or a practice, and the small parts that name one elsewhere (its link, the owner or member mark, its contact details).",
      requirements: [
        { text: "\"You are an owner / a member\" uses the brand's soft tint, so it reads as information, not as a warning.", at: ".rank-mark {" },
      ],
    },
    {
      path: "src/search.css",
      role: "Home and the search results page.",
      requirements: [
        { text: "Home: the search on the left, the ways to browse on the right (below it on a small screen, `e2e/browse.spec.ts`).", at: ".home-layout {" },
      ],
    },
    {
      path: "src/share.css",
      role: "The share dialog: the link with its copy button and the other ways of sharing.",
      requirements: [
        { text: "The link is shown in monospace in a read-only field and cut with an ellipsis inside it.", at: ".share-link .share-url {" },
      ],
    },
    {
      path: "src/icons.css",
      role: "Uploaded icons of tools and languages, on a tile so a transparent icon reads in both themes.",
      requirements: [
        { text: "The tile is `--logo-plate`: none in the light theme, a light plate in the dark theme (a dark icon on the dark surface would vanish); it is a neutral, not a brand or state colour, and no colour literal.", at: ".entry-icon {" },
      ],
    },
    {
      path: "src/picture.css",
      role: "What a process drawn as a picture in a text adds to the map's look: its caption, its compact tools, the Enlarge dialog and printing it whole.",
      requirements: [
        { text: "A picture inline has no height limit: it never scrolls up and down, so the page scrolls on over it.", at: ".flow-wrap.picture-inline .flow-scroll, .flow-wrap.picture-print .flow-scroll { max-height: none; }" },
      ],
    },
    {
      path: "src/print.css",
      role: "The printed page: light paper whatever the theme, without the top bar and controls.",
      requirements: [
        { text: "Colours print as on screen (`print-color-adjust: exact`); without it browsers drop the tags' and level bars' backgrounds.", at: "* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }" },
      ],
    },
    {
      path: "src/components/EntryIcon.tsx",
      role: "The uploaded icon of a tool or a language: a fixed-size square image, decoration next to the name.",
      requirements: [
        { text: "An image that fails to load is replaced by the fallback instead of a broken-image box.", at: "onError={() => setFailed(true)}" },
      ],
      tests: ["e2e/icons.spec.ts"],
    },
    {
      path: "src/lib/icons.ts",
      role: "What the app checks about an icon file before uploading it; the server checks the rest.",
      requirements: [
        { text: "Type and size are checked here only to explain early; squareness, pixel size and a safe SVG drawing are refused by `server/internal/icons`, which is the check that counts.", at: "if (!(ICON_TYPES as readonly string[]).includes(type)) return" },
      ],
      tests: ["src/lib/__tests__/icons.test.ts"],
    },
    {
      path: "src/main.tsx",
      role: "Imports the fonts shipped with the app and the global stylesheets.",
      requirements: [
        { text: "Roboto is the default font (`--font-family` names it first), upright and italic for emphasis; Inter is declared too, and its files are fetched only when a look chooses it. Declaring a font fetches nothing.", at: "import \"@fontsource-variable/roboto\";" },
      ],
    },
    {
      path: "src/lib/media.ts",
      role: "Re-measuring text once fonts have arrived, in the font really shown.",
      requirements: [
        { text: "Nothing is called when every font had arrived already, so the map's lane names are not measured twice and do not jump.", at: "if (fonts.status === \"loading\") fonts.ready?.then(done, () => {});" },
      ],
      tests: ["src/lib/__tests__/fonts.test.ts"],
    },
  ],
};
