import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const look: CodeCategory = {
  id: "look",
  area: "app",
  title: "The look",
  summary: "How the portal looks: the colour tokens of the light and the dark theme (styles.css), the shared parts that say the same thing the same way on every page (marks.tsx, controls.css), and the look an admin sets in Admin › Theming. The server keeps only what the admin chose; src/lib/theme.ts works out every colour from it, readable in both themes, and sets it as CSS custom properties that the token blocks read with the default look as fallback.",
  requirements: [
    "Every colour that follows the brand or a state goes through a token: --accent (text, links, outlines), --accent-fill with --accent-ink (filled surfaces), --action-fill / --action-ink (the one main button), --action-other* (other buttons), --good / --warn / --bad / --info with -bg, -fill, -ink, the kind tokens --kind-process-* and --kind-standard-*, and --font-family.",
    "A look is stored as what the admin chose only (portal_settings, key theme); every derived colour is worked out in the browser by derive() and never stored.",
    "Each chosen colour is made readable at 4.5:1 on every surface of each theme (readable()), only by making it lighter or darker; buttons and states in the dark theme also on the dark editing bar (BAR).",
    "A part left at its default sets nothing: the CSS fallback in var(--theme-light-…, default) applies. In the preview, lookProperties sets such parts to initial so the defaults apply inside it too.",
    "The person's own light or dark choice wins over the look's appearance, which wins over the device (isDark).",
    "The look is applied before the first drawing from the last one kept in this browser (pm:look); a new visitor waits for GET /api/theme at most 3 seconds.",
    "A level (Mandatory / Must …) is drawn in neutral ink, never in the problem colour; a review that is due is a warning, an overdue one a problem.",
    "A chosen segment (.seg-item.on) is raised and outlined with text in --accent, not filled; the fill is for the one main button of a view.",
    "Search highlights use --search-mark, which does not follow the brand.",
    "Fonts ship with the app (@fontsource-variable/inter and /roboto); no stylesheet or font is loaded from another host.",
  ],
  charts: [
    {
      caption: "From a change in Admin › Theming to the colours in every browser. The server refuses a save made from an outdated revision, like every other save.",
      process: flow("code-look-save", "A look from Admin to every browser", "How a chosen look is saved and reaches everybody.",
        [["admin", "Admin"], ["browser", "Browser"], ["server", "Server"], ["postgres", "Postgres"]],
        [
          s("edit", "Choose name, logo, colours, font", "admin", "form", ["derive"], "Admin › Theming"),
          s("derive", "Work out both themes in the preview", "browser", "automation", ["save"], "derive, lookProperties"),
          s("save", "Save on top of the revision", "admin", "task", ["newer"], "PUT /api/admin/theme?rev="),
          s("newer", "Saved by someone since?", "server", "decision", [["conflict", "Yes"], ["write", "No"]]),
          s("conflict", "Refuse, keep the changes on screen", "browser", "communication", [], "409, who saved"),
          s("write", "Store only what was chosen", "postgres", "automation", ["take"], "portal_settings, key theme"),
          s("take", "Use it and keep it in this browser", "browser", "automation", ["later"], "takeLook, pm:look"),
          s("later", "Open the portal later", "browser", "code", ["fetch"], "startLook: the last look first"),
          s("fetch", "Fetch the current look", "browser", "communication", ["apply"], "GET /api/theme, 3 s at most"),
          s("apply", "Set the tokens on the root element", "browser", "automation", [], "--theme-light-…, data-theme"),
        ]),
    },
    {
      caption: "deriveColor for one chosen colour in one theme: the text colour, the soft tint, the fill and the ink on the fill.",
      process: flow("code-look-colour", "Working out one colour", "What theme.ts does with one chosen colour, per theme.",
        [["browser", "Browser"]],
        [
          s("chosen", "Take the chosen colour", "browser", "form", ["reads"], "#rrggbb"),
          s("reads", "Readable on every surface?", "browser", "decision", [["keep", "Yes"], ["move", "No"]], "4.5:1, SURFACES"),
          s("move", "Make it only lighter or darker", "browser", "automation", ["soft"], "readable(): same hue"),
          s("keep", "Keep it as the text colour", "browser", "automation", ["soft"]),
          s("soft", "Mix the soft tint and the line", "browser", "automation", ["fills"], "mix with the surface"),
          s("fills", "Fill stands out from the surface?", "browser", "decision", [["fill-chosen", "Yes"], ["fill-text", "No"]], "1.4:1, FILL_MIN"),
          s("fill-chosen", "Fill with the chosen colour", "browser", "automation", ["ink"]),
          s("fill-text", "Fill with the readable variant", "browser", "automation", ["ink"]),
          s("ink", "Put white or near-black ink on it", "browser", "automation", ["warn"], "inkOn"),
          s("warn", "Warn what it will be mistaken for", "browser", "verify", [], "CIELAB distance < 25"),
        ]),
    },
  ],
  tables: [
    {
      name: "portal_settings",
      purpose: "Settings of the installation; today one row, the look of the portal (key 'theme').",
      columns: [
        { name: "key", type: "text", note: "primary key; the check allows only 'theme'" },
        { name: "value", type: "jsonb", note: "the look as chosen: name, logo (an icon id), colours as #rrggbb, appearance, font" },
        { name: "revision", type: "int", note: "1 for the first save, one more for each save; a save names the revision it was made from" },
        { name: "updated_by", type: "text", note: "email of whoever saved last" },
        { name: "updated_by_name", type: "text" },
        { name: "updated_at", type: "timestamptz" },
      ],
      keys: ["primary key (key)", "check (key in ('theme'))", "check (revision > 0)"],
      createdIn: "server/internal/db/migrations/010_portal_settings.sql",
      writtenBy: ["server/internal/theme/theme.go"],
      readBy: ["server/internal/httpapi/theme.go", "src/lib/theme.ts"],
      rules: [
        "Only what the admin chose is stored; derived colours never are.",
        "A save from an outdated revision is refused (theme.Conflict, answered as 409 with who saved).",
      ],
    },
  ],
  examples: [
    {
      title: "A yellow brand colour",
      caption: "What happens to one chosen colour on its way to the page: in the light theme it is darkened to read on white, in the dark theme it is kept.",
      stages: [
        { label: "Chosen in Admin › Theming", where: "src/components/ThemeSection.tsx", shape: "{ \"name\": \"Platform Portal\", \"brand\": \"#FDE047\" }", note: "Typed or picked; normalizeHex writes it in lower case." },
        { label: "Cleaned and stored", where: "src/lib/theme.ts", shape: "portal_settings: key = 'theme', value = { \"name\": \"Platform Portal\", \"brand\": \"#fde047\" }", note: "cleanLook keeps only valid parts; nothing derived is stored." },
        { label: "Derived for both themes", where: "src/lib/theme.ts", shape: "{\n  \"light\": { \"accent\": \"#846f01\", \"accent-fill\": \"#846f01\", \"accent-ink\": \"#ffffff\", \"accent-soft\": \"#fffced\" },\n  \"dark\":  { \"accent\": \"#fde047\", \"accent-fill\": \"#fde047\", \"accent-ink\": \"#11121c\", \"accent-soft\": \"#413e2b\" }\n}", note: "On white the yellow is far below 4.5:1, so the light theme uses a dark yellow, also as the fill (the chosen fill would vanish into the surface). It is marked as looking like the warning colour (like: [\"warn\"])." },
        { label: "Set on the root element", where: "src/lib/theme.ts", shape: "<html data-theme=\"light\" style=\"--theme-light-accent: #846f01; --theme-light-accent-fill: #846f01; … --theme-dark-accent-soft: #413e2b\">", note: "apply() removes every property of an earlier look first." },
        { label: "Read by the token block", where: "src/styles.css", shape: "--accent: var(--theme-light-accent, #4f46e5);  /* now #846f01 */", note: "Every link, outline and selected tab uses --accent; nothing else changes." },
      ],
    },
  ],
  start: "src/styles.css",
  files: [
    {
      path: "src/styles.css",
      role: "The tokens of the light and the dark theme, the base styles, and the styles of most pages (top bar, buttons, page, map, checklist, drawer, forms, dialogs, Guide, standards, skills, admin).",
      requirements: [
        { text: "The light tokens read --theme-light-… with the default look as fallback; .look-light gives an element inside the page the same tokens (the preview).", at: ":root, .look-light {" },
        { text: "The dark tokens apply under data-theme=\"dark\" (set by theme.ts) and on .look-dark.", at: ":root[data-theme=\"dark\"], .look-dark {" },
        { text: "The font is --font-family: the chosen one first (--theme-font), then Inter, then the system's.", at: "--font-family: var(--theme-font, \"Inter Variable\", Inter)" },
        { text: "The -on-dark tokens are for the editing bar, dark in both themes.", at: "--accent-on-dark:" },
        { text: "The one main button of a view is filled with --action-fill; other buttons are outlined in --action-other*, neutral when none is chosen.", at: ".btn.primary { background: var(--action-fill);" },
        { text: "Below 1120 pixels the places of the top bar move into the Menu.", at: "@media (max-width: 1119px) {" },
      ],
      tests: ["e2e/theming.spec.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/lib/theme.ts",
      role: "Works out every colour of a look for light and dark, warns what will be mistaken for what, and applies the look to the page.",
      requirements: [
        { text: "The surfaces a colour must read on; they must match the token blocks of styles.css.", at: "export const SURFACES = {" },
        { text: "Only lighter or darker, same hue and saturation, as close to the chosen colour as passes 4.5:1 on every background.", at: "export function readable(" },
        { text: "Text, fill, ink, soft tint and line of one colour; a fill keeps the chosen colour unless it stands less than 1.4:1 off the surface.", at: "export function deriveColor(" },
        { text: "Only chosen parts produce tokens; buttons and states in the dark theme also read on the editing bar.", at: "export function derive(look: Look): Derived {" },
        { text: "Only valid parts of what came from storage or the server are used.", at: "export function cleanLook(x: unknown): Look {" },
        { text: "Sets the custom properties and data-theme on the root element; nothing builds style text or code at run time.", at: "function apply() {" },
        { text: "Puts the last look in place before the first drawing and follows the device's light or dark setting.", at: "export function startLook() {" },
        { text: "Fetches the look (also before signing in), gives up after 3 seconds and keeps the last look on any failure; afterwards the look counts as known, so nothing waits for it any longer.", at: "export async function refreshLook(): Promise<void> {" },
        { text: "The person's own choice, then the look's appearance, then the device.", at: "export function isDark(" },
      ],
      tests: ["src/lib/__tests__/theme.test.ts", "e2e/theming.spec.ts"],
    },
    {
      path: "src/theme.css",
      role: "Admin › Theming (settings and preview), and the uploaded logo in the top bar and on the sign-in page.",
      requirements: [
        { text: "A nearly grey brand colour underlines links, as colour alone would not tell them from text.", at: ":root[data-link-lines] a:not([class])" },
        { text: "The preview uses only the tokens, so it follows the look being edited.", at: ".preview-pane {" },
      ],
    },
    {
      path: "src/controls.css",
      role: "The styles of the shared parts: kind tag, level mark, fact line, underline tabs and the segmented control.",
      requirements: [
        { text: "A chosen segment is raised and outlined (--seg-on, --seg-on-line) with text in --accent; it is never filled with the brand.", at: ".seg-item.on { background: var(--seg-on);" },
        { text: "A process tag is round, a standard tag square, each in its kind tokens.", at: ".kind-tag.process {" },
        { text: "The level mark is in neutral ink (--text, --text-2, --text-3), never in the problem colour.", at: ".level-mark { display: inline-flex;" },
      ],
    },
    {
      path: "src/components/marks.tsx",
      role: "The shared parts that say the same thing the same way on every page: KindTag, LevelMark, LevelBars, NoLevelMark, Fact.",
      requirements: [
        { text: "PROCESS and STANDARD with their icon, in the kind colours; the icon-only size keeps the word for screen readers.", at: "export function KindTag(" },
        { text: "Three bars for mandatory / must, two for recommended / should, one for optional / may, always with the word.", at: "const BARS: Record<AnyLevel, number>" },
        { text: "The word of a level comes from levelWord (search.ts): one vocabulary everywhere.", at: "export function LevelMark(" },
      ],
      tests: ["e2e/pages.spec.ts", "e2e/cards.spec.ts"],
    },
    {
      path: "src/components/ThemeSection.tsx",
      role: "Admin › Theming: the name, the logo, the colours, the font and the appearance, with a live preview in both themes.",
      requirements: [
        { text: "Saved through useDraft like every other save: Undo, unsaved-changes guard (key theme) and the refusal of an outdated revision.", at: "docKey: \"theme\", saved: saved.look" },
        { text: "Save asks once about the warnings of the look; the same warnings are not asked about again.", at: "if (warnings > 0 && accepted.current !== said) {" },
        { text: "A saved look is taken into use at once in this browser.", at: "takeLook(s.look, s.revision);" },
        { text: "The two fonts offered: the default Inter and Roboto.", at: "const FONT_CHOICES" },
      ],
      tests: ["src/lib/__tests__/theme.test.ts", "e2e/theming.spec.ts"],
    },
    {
      path: "src/components/Brand.tsx",
      role: "The portal's logo tile: the uploaded logo, or the default mark on the brand fill.",
      requirements: [
        { text: "The uploaded logo is served by /api/theme/logo, versioned by the start of its id.", at: "export function BrandLogo(" },
      ],
    },
    {
      path: "src/lib/stepMeta.ts",
      role: "The kinds of steps (label, colour, when to use) for the map, the legend and the prompts, and the colours of the lanes.",
      requirements: [
        { text: "The first lane (\"You\") follows the brand (var(--accent)); the other lanes and the kinds of steps keep fixed colours.", at: "export const LANE_COLORS = [" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/lists.css",
      role: "The lists of processes and standards and the search results: the filter panel, the cards and rows, the pages, the search box.",
      requirements: [
        { text: "The search highlight has its own colour in each theme and does not follow the brand.", at: ":root, .look-light { --search-mark: #fdeca6; }" },
        { text: "A draft mark is a warning, a mark that needs fixing a problem.", at: ".card-mark.draft {" },
      ],
    },
    {
      path: "src/detail.css",
      role: "The reader's pages of processes and standards: the use and feedback line, sharing, the map's extras.",
      requirements: [
        { text: "An upvote or bookmark that is on is shown in the brand's soft tint.", at: ".engage-btn.on {" },
      ],
    },
    {
      path: "src/group.css",
      role: "The page of a team, a platform or a practice, and the small parts that name one elsewhere (its link, the owner or member mark, its contact details).",
      requirements: [
        { text: "\"You are an owner / a member\" is one small mark in the brand's soft tint.", at: ".rank-mark {" },
      ],
    },
    {
      path: "src/search.css",
      role: "Home and the search results page.",
      requirements: [
        { text: "Home: the search and the rest on the left, the ways to browse on the right.", at: ".home-layout {" },
      ],
    },
    {
      path: "src/share.css",
      role: "The share dialog: the link with its copy button and the other ways of sharing.",
      requirements: [
        { text: "The link is shown in monospace in a read-only field.", at: ".share-link .share-url {" },
      ],
    },
    {
      path: "src/icons.css",
      role: "Uploaded icons of tools and languages, on a light neutral tile so a transparent icon reads in both themes.",
      requirements: [
        { text: "The tile is light in both themes on purpose (a neutral, not a brand or state colour).", at: ".entry-icon {" },
      ],
    },
    {
      path: "src/print.css",
      role: "The printed page: light paper whatever the theme, without the top bar and controls.",
      requirements: [
        { text: "Colours, fills and marks print as on the screen (print-color-adjust: exact).", at: "* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }" },
      ],
    },
    {
      path: "src/components/EntryIcon.tsx",
      role: "The uploaded icon of a tool or a language: a fixed-size square image, decoration next to the name.",
      requirements: [
        { text: "alt is empty (the name is always written beside it); an image that fails to load shows the fallback.", at: "export function EntryIcon(" },
      ],
      tests: ["e2e/icons.spec.ts"],
    },
    {
      path: "src/lib/icons.ts",
      role: "What the app checks about an icon file before uploading it; the server checks the rest.",
      requirements: [
        { text: "PNG, JPEG, WebP or SVG, at most 64 KB; squareness, pixel size and a safe drawing are the server's checks.", at: "export const ICON_MAX_BYTES = 64 * 1024;" },
      ],
      tests: ["src/lib/__tests__/icons.test.ts"],
    },
    {
      path: "src/main.tsx",
      role: "Imports the fonts shipped with the app and the global stylesheets.",
      requirements: [
        { text: "Inter is the default font; Roboto is offered in Admin › Theming and its files are fetched only when it is in use.", at: "import \"@fontsource-variable/inter\";" },
      ],
    },
    {
      path: "src/lib/media.ts",
      role: "Re-measuring text once fonts have arrived, in the font really shown.",
      requirements: [
        { text: "Text measured in code (the lane names of the map) is measured again when a font arrives, e.g. Roboto chosen in Theming.", at: "export function watchFonts(" },
        { text: "Measuring uses --font-family, which follows Theming.", at: "export function pageFontFamily(): string {" },
      ],
      tests: ["src/lib/__tests__/fonts.test.ts"],
    },
  ],
};
