import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const look: CodeCategory = {
  id: "look",
  area: "app",
  title: "The look",
  summary: "How the portal looks: colour tokens for light and dark, the shared marks, and the look an admin sets in Admin › Theming. The token blocks of `styles.css` define every colour; `marks.tsx` and `controls.css` draw what every page shows the same way (kind tag, level, fact, tabs, segments). The server keeps only what the admin chose (`portal_settings`); `src/lib/theme.ts` works out every colour from it, readable in both themes, and sets it as CSS custom properties that the token blocks read, with the default look as fallback.",
  requirements: [
    "Every colour that follows the brand or a state goes through a token: `--accent` (text, links, outlines), `--accent-fill` with `--accent-ink`, `--action-fill` / `--action-ink` (the one main button), `--action-other*`, `--good` / `--warn` / `--bad` / `--info` with `-bg`, `-fill`, `-ink`, `--kind-process-*`, `--kind-standard-*`, and `--font-family`. A literal colour there would ignore Theming.",
    "Only what the admin chose is stored (`portal_settings`, key `theme`); every derived colour is worked out in the browser by `derive()`, so an improved rule applies to every stored look without a migration.",
    "A chosen colour is made readable at 4.5:1 on every surface of each theme only by making it lighter or darker (`readable()`); buttons and states in the dark theme must also read on the dark editing bar (`BAR`).",
    "A part left at its default sets no property, so the fallback in `var(--theme-light-…, default)` applies; the preview sets such parts to `initial` (`lookProperties`) so that the admin's own saved look does not leak into it.",
    "The defaults are written twice, in the token blocks of `styles.css` and in `theme.ts` (`SURFACES`, `SEMANTIC`, `DEFAULT_USE`, `KIND_DEFAULT`), and nothing tests that they agree; changing one without the other makes the warnings of Theming wrong.",
    "Light or dark: the person's own choice wins, then the look's appearance, then the device (`isDark`).",
    "A level (Mandatory / Must …) is drawn in neutral ink, never in the problem colour; a review that is due is a warning, an overdue one a problem.",
    "A chosen segment (`.seg-item.on`) is raised and outlined with its text in `--accent`, never filled; the fill is for the one main button of a view. Search highlights use `--search-mark`, which does not follow the brand.",
    "Fonts ship with the app (`@fontsource-variable/inter`, `/roboto`); no stylesheet or font is loaded from another host.",
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
          s("reads", "Readable on every surface?", "browser", "decision", [["soft", "Yes"], ["move", "No"]], "4.5:1, SURFACES"),
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
        { label: "Derived for both themes", where: "src/lib/theme.ts", shape: "{\n  \"light\": { \"accent\": \"#846f01\", \"accent-fill\": \"#846f01\", \"accent-ink\": \"#ffffff\", \"accent-soft\": \"#fffced\" },\n  \"dark\":  { \"accent\": \"#fde047\", \"accent-fill\": \"#fde047\", \"accent-ink\": \"#11121c\", \"accent-soft\": \"#413e2b\" }\n}", note: "On white the yellow is far below 4.5:1, so the light theme uses a dark yellow, also as the fill (the chosen fill would vanish into the surface). It is marked as looking like the warning colour (like: [\"warn\"])." },
        { label: "Set on the root element", where: "src/lib/theme.ts", shape: "<html data-theme=\"light\" style=\"--theme-light-accent: #846f01; --theme-light-accent-fill: #846f01; … --theme-dark-accent-soft: #413e2b\">", note: "`apply()` removes every property of an earlier look first." },
        { label: "Read by the token block", where: "src/styles.css", shape: "--accent: var(--theme-light-accent, #4f46e5);  /* now #846f01 */", note: "Every link, outline and selected tab uses `--accent`; nothing else changes." },
      ],
    },
  ],
  start: "src/styles.css",
  files: [
    {
      path: "src/styles.css",
      role: "The tokens of the light and the dark theme, the base styles, and the styles of most pages (top bar, buttons, page, map, checklist, drawer, forms, dialogs, Guide, standards, skills, admin).",
      requirements: [
        { text: "The light surfaces and the default brand, kind and state colours here must equal their copies in `theme.ts` (`SURFACES.light`, `DEFAULT_USE`, `SEMANTIC`, `KIND_DEFAULT`): Theming measures contrast and likeness against those copies, and no test checks that they agree.", at: ":root, .look-light {" },
        { text: "The dark block is a second, hand-tuned set (not computed from the light one), with the same copies in `theme.ts` (`SURFACES.dark` and the dark defaults). It applies on `:root[data-theme=\"dark\"]`, which only `theme.ts` sets.", at: ":root[data-theme=\"dark\"], .look-dark {" },
        { text: "`--action-other` has no default on purpose: every use writes `var(--action-other, …)` with the neutral look as fallback, so an unchosen colour leaves the other buttons neutral.", at: "--action-other: var(--theme-light-action-other);" },
        { text: "The `-on-dark` tokens read only `--theme-dark-…`: the editing bar is dark in both themes, so its colours must come from the dark set even in the light theme.", at: "--accent-on-dark:" },
        { text: "Below 1120 pixels `.topbar > .nav` is hidden and the Menu shown; the breakpoint must stay where the longest top bar (an admin with eight places) still fits (`e2e/layout.spec.ts`).", at: "@media (max-width: 1119px) {" },
      ],
      tests: ["e2e/theming.spec.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/lib/theme.ts",
      role: "Works out every colour of a look for light and dark, warns what will be mistaken for what, and applies the look to the page.",
      requirements: [
        { text: "A colour that already passes is kept exactly; only one that fails is searched for, by lightness alone, so a chosen hue is never swapped for another.", at: "if (passes(hex)) return hex.toLowerCase();" },
        { text: "The fill keeps the chosen colour (a yellow button stays yellow with dark ink) unless it stands less than 1.4:1 off the surface; then the readable variant is the fill.", at: "const fill = [s.surface, ...also].every((b) => contrast(chosen, b) >= FILL_MIN) ? chosen.toLowerCase() : text;" },
        { text: "Buttons and states (not the brand or the kinds) must also read on the dark editing bar in the dark theme.", at: "const also = mode === \"dark\" && ![\"brand\", \"process\", \"standard\"].includes(part) ? BAR : [];" },
        { text: "A part that is not a valid #rrggbb produces no token, so its CSS default applies.", at: "if (!isHex(chosen)) continue;" },
        { text: "A logo is used only when it is a 64-character icon id; anything else from storage or the server is ignored, so no other text ever becomes part of the logo's address.", at: "if (typeof o.logo === \"string\" && ICON_ID.test(o.logo)) out.logo = o.logo;" },
        { text: "Every property of an earlier look is removed before the new one is set, so a colour taken back to its default does not linger.", at: "for (const p of ALL_PROPERTIES) root.style.removeProperty(p);" },
        { text: "The look is fetched also before signing in (the sign-in page shows it); after 3 seconds the request is given up and the last look stays, so a slow server never keeps a new visitor on a blank page.", at: "const timer = setTimeout(() => stop?.abort(), 3000);" },
        { text: "The switch in the top bar (`pm:theme`) beats the look's appearance.", at: "if (own === \"dark\" || own === \"light\") return own === \"dark\";" },
      ],
      tests: ["src/lib/__tests__/theme.test.ts", "e2e/theming.spec.ts"],
    },
    {
      path: "src/components/ThemeSection.tsx",
      role: "Admin › Theming: the name, the logo, the colours, the font and the appearance, with a live preview in both themes.",
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
        { text: "A chosen segment is a raised surface with an outline (`--seg-on`, `--seg-on-line`); it reads as chosen by its shape alone, also for someone who cannot tell the brand colour from grey.", at: ".seg-item.on { background: var(--seg-on);" },
        { text: "The level mark uses only `--text`, `--text-2`, `--text-3`: a level is a fact, never drawn as a problem.", at: ".level-mark { display: inline-flex;" },
      ],
    },
    {
      path: "src/components/marks.tsx",
      role: "The shared parts that say the same thing the same way on every page: `KindTag`, `LevelMark`, `LevelBars`, `NoLevelMark`, `Fact`.",
      requirements: [
        { text: "The icon-only kind tag keeps the word as screen-reader text, so a row of a list still says Process or Standard.", at: "<Icon size={13} aria-hidden=\"true\" /><span className=\"card-kind sr-only\">{word}</span>" },
        { text: "The word of a level comes from `levelWord` (`search.ts`), the same that names the filter options.", at: "const word = levelWord(level);" },
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
      role: "The kinds of steps (label, colour, when to use) for the map, the legend and the prompts, and the colours of the lanes.",
      requirements: [
        { text: "Only the first lane (\"You\") follows the brand (`var(--accent)`); the kinds of steps and the other lanes are fixed colours, not tokens, so Theming does not change them.", at: "export const LANE_COLORS = [" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/lists.css",
      role: "The lists of processes and standards and the search results: the filter panel, the cards and rows, the pages, the search box.",
      requirements: [
        { text: "`--search-mark` is defined here, with a dark value, and is not part of a look: a brand-coloured highlight would look like a link.", at: ":root, .look-light { --search-mark: #fdeca6; }" },
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
      role: "Uploaded icons of tools and languages, on a light neutral tile so a transparent icon reads in both themes.",
      requirements: [
        { text: "The tile is a fixed light grey in both themes on purpose (a dark icon on the dark surface would vanish); it is a neutral, not a brand or state colour.", at: ".entry-icon {" },
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
        { text: "Inter is the default font (`--font-family` falls back to it); Roboto is declared too, but its files are fetched only when a look chooses it.", at: "import \"@fontsource-variable/inter\";" },
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
