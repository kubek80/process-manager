import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const reading: CodeCategory = {
  id: "reading",
  area: "app",
  title: "Reading and finding",
  summary: "Everything a reader uses: Home, the Processes and Standards lists, the search results, the reader's page of a process (map, checklist, feedback, skills) and of a standard, the pages of teams, platforms and practices, and the Guide. The three lists share one search (search() in src/lib/search.ts) and one card (DocCard); the map is drawn by one component (FlowView) with one set of zoom rules. Views, bookmarks and upvotes are read through useEngagement; when a review is due is decided by reviewOf.",
  requirements: [
    "The Processes list, the Standards list and the search results use the same search() and DocCard; a filter, a field of the word search or the card is changed there once, not per page.",
    "The word search finds a document only when every word of the query is in it somewhere; case and accents do not matter. Several values of one filter mean any of them, different filters all of them.",
    "The app shows the drafts the server sends (search() is called with drafts: true); hiding a draft from whoever may not see it is the server's job, and search by meaning never returns one.",
    "A result of search by meaning that is not among the documents the page has is dropped (fromMeaning), so the server's answer can never show something the person may not see.",
    "A filter value in an address that names nothing that exists is dropped, the address corrected in place and a notice shown once (useLinkFilters with knownFilters).",
    "Whether a review is due is decided by reviewOf / needsReview (src/lib/lifecycle.ts) on every page: counted from the last review, or for one never reviewed from its first publication (meta.publishedAt); due within 30 days is a warning, past the date a problem.",
    "Views, bookmarks, upvotes and downloads are read only through useEngagement; they show counts only, never who; while they are not known no number is shown (a 0 would look like a fact).",
    "A view is recorded once per page load and document, and never for a draft (the reader's pages show DocEngagement only when status is not draft).",
    "The reader's page changes nothing: it offers Edit (to whoever may draft it) and Mark as reviewed (to whoever may edit it or owns its team); everything else happens on the editing screen.",
    "The map's zoom rules are one module, src/lib/zoom.ts, used by the reader's map, the editing map and the Guide's charts; the blocks of the map are one Tab stop and the arrow keys move between steps.",
  ],
  charts: [
    {
      caption: "A search on the results page. By words it runs in the browser as the person types; by meaning (or both) the server is asked when the search is run, and only what the page already has is shown.",
      process: flow("code-reading-search", "A search, by words or by meaning", "From typed words to cards on the results page.",
        [["reader", "Reader"], ["browser", "Browser"], ["server", "Server"]],
        [
          s("type", "Type words, press Enter", "reader", "task", ["address"]),
          s("address", "Write the search into the address", "browser", "code", ["mode"], "#/search?q=…&mode=…"),
          s("mode", "Searching by words?", "browser", "decision", [["words", "Words"], ["ask", "Meaning or Both"]]),
          s("ask", "Ask for the closest published ones", "browser", "communication", ["rank"], "GET /api/search, kept 2 min"),
          s("rank", "Rank the published parts by meaning", "server", "automation", ["keep"], "never a draft"),
          s("keep", "Keep only documents the page has", "browser", "code", ["filter"], "fromMeaning; Both: fuse"),
          s("words", "Find every word, score the fields", "browser", "code", ["filter"], "search(): title 100 … inside 5"),
          s("filter", "Apply filters and My application", "browser", "automation", ["order"], "counts per option"),
          s("order", "Sort and cut into pages", "browser", "automation", ["cards"], "sortResults, pageOf"),
          s("cards", "Draw the cards and the places found", "browser", "automation", [], "DocCard, Marked"),
        ]),
    },
    {
      caption: "reviewInfo in src/lib/lifecycle.ts, as every page calls it through reviewOf. The same decision is made by the MCP server.",
      process: flow("code-reading-review", "When a review is due", "How the review state of a process or standard is decided.",
        [["browser", "Browser"]],
        [
          s("start", "Take the document and its meta", "browser", "document", ["planned"], "reviewOf(doc, meta)"),
          s("planned", "Active, with an interval?", "browser", "decision", [["none", "No"], ["last", "Yes"]]),
          s("none", "Say: no review planned", "browser", "automation", []),
          s("last", "Reviewed before?", "browser", "decision", [["from-last", "Yes"], ["published", "No"]], "lastReviewedAt"),
          s("published", "First publication known?", "browser", "decision", [["from-pub", "Yes"], ["never", "No"]], "publishedAt, else createdAt"),
          s("never", "Mark it overdue: never reviewed", "browser", "automation", []),
          s("from-pub", "Count from the first publication", "browser", "code", ["due"]),
          s("from-last", "Count from the last review", "browser", "code", ["due"], "a date that cannot be read: overdue"),
          s("due", "How many days are left?", "browser", "decision", [["overdue", "Below 0"], ["soon", "30 or fewer"], ["ok", "More"]], "interval in months added"),
          s("overdue", "Mark overdue, as a problem", "browser", "automation", []),
          s("soon", "Mark due, as a warning", "browser", "automation", []),
          s("ok", "Show the next date quietly", "browser", "automation", []),
        ]),
    },
    {
      caption: "Opening the reader's page of a process from a link.",
      process: flow("code-reading-open", "Opening a process page", "From a link to the map on screen.",
        [["reader", "Reader"], ["browser", "Browser"], ["server", "Server"]],
        [
          s("open", "Open a link to a process", "reader", "task", ["parse"], "#/p/:id/flow/:step"),
          s("parse", "Read the page, tab and step", "browser", "code", ["phone"], "parseRoute"),
          s("phone", "A phone, and the map without a step?", "browser", "decision", [["list", "Yes"], ["draft", "No"]]),
          s("list", "Switch to the checklist in place", "browser", "automation", ["draft"], "arrivalTab, replace"),
          s("draft", "Is it a draft?", "browser", "decision", [["show", "Yes"], ["view", "No"]]),
          s("view", "Record one view", "browser", "communication", ["count"], "once per page load"),
          s("count", "Count it once a day per person", "server", "automation", ["show"], "POST /api/views/…"),
          s("show", "Draw the head, the tabs and the page", "browser", "automation", ["zoom"], "DocHead"),
          s("zoom", "Open the map at a readable zoom", "browser", "code", [], "openingZoom"),
        ]),
    },
  ],
  examples: [
    {
      title: "One address through the Processes list",
      caption: "The sample process request-gcp-project, found from a shared link to the Processes list.",
      stages: [
        { label: "The address", shape: "#/processes?q=gcp%20project&platform=google-cloud&sort=updated&page=1", note: "Shared, reloaded or come back to with Back: the list is the same." },
        { label: "Read by parseRoute", where: "src/lib/store.ts", shape: "{ \"page\": \"library\", \"q\": \"gcp project\", \"platform\": [\"google-cloud\"], \"sort\": \"updated\", \"pageNo\": 1 }", note: "Written back by href, page 1 is left out: #/processes?q=gcp%20project&platform=google-cloud&sort=updated" },
        { label: "Searched by search()", where: "src/lib/search.ts", shape: "{\n  \"kind\": \"process\", \"id\": \"request-gcp-project\", \"score\": 225,\n  \"rigour\": { \"mandatory\": 1 }, \"rules\": 0,\n  \"hits\": [\n    { \"where\": \"step\", \"item\": \"raise-request\", \"label\": \"Raise the 'New GCP project' request\" },\n    { \"where\": \"step\", \"item\": \"verify-access\", \"label\": \"Check you can open the project\" },\n    { \"where\": \"prerequisite\", \"label\": \"Google group for your team\",\n      \"snippet\": \"The group becomes owner of the project, e.g. gcp-myteam-admins@example.com.\" }\n  ]\n}", note: "Both words are in the title (100 each) and the title contains the phrase (+25). The platform filter offers Google Cloud with count 1, chosen." },
        { label: "Paged by pageOf", where: "src/lib/paging.ts", shape: "{ \"page\": 1, \"pages\": 1, \"first\": 1, \"last\": 1, \"total\": 1, \"start\": 0, \"end\": 1 }", note: "One result: the bar says \"1 process\", no pager." },
        { label: "Lines of the card", where: "src/lib/cardLines.ts", shape: "[\n  { \"key\": \"owner\", \"name\": \"Owner\", \"value\": \"Cloud Platform team\" },\n  { \"key\": \"platform\", \"name\": \"Platform\", \"value\": \"Google Cloud\" },\n  { \"key\": \"rigour\", \"name\": \"Rigour\", \"value\": \"Mandatory\" },\n  { \"key\": \"lead\", \"name\": \"Lead time\", \"value\": \"3-5 working days\" },\n  { \"key\": \"steps\", \"name\": \"Steps\", \"value\": \"5 of 10 are yours\" }\n]", note: "Reviewed on 2026-11-03 every 6 months: next review 2027-05-03, so an editor sees no review mark yet." },
      ],
    },
  ],
  start: "src/lib/search.ts",
  files: [
    {
      path: "src/lib/search.ts",
      role: "The one search over processes and standards: words, filters, counts per option, My application, and the marking of the words found.",
      requirements: [
        { text: "Weights of the fields: title 100, id and tags 60, the names of category, practice, platform and owner 40, summary 20, anything inside (steps, prerequisites, requirements, scope) 5.", at: "const WEIGHT = { title: 100, id: 60, tags: 60, names: 40, summary: 20, inside: 5 } as const;" },
        { text: "A document is found only when every word is somewhere in it.", at: "if (!best) return 0;" },
        { text: "A draft is listed only when the caller allows it, and only what applies to My application.", at: "const visible = (kind: \"process\" | \"standard\") => (d: Process | Standard) =>" },
        { text: "Results found another way (by meaning, or both) keep their order and places; the filters and counts work on them as on a word search.", at: "found?: { kind: TargetKind; id: string; score: number; hits: Hit[]; by?: (\"words\" | \"meaning\")[] }[];" },
        { text: "A filter value counts as existing when the lists have it or a document uses it; \"Other\" (no category) always exists.", at: "export function knownFilters(" },
        { text: "Words of one or two letters are marked only as whole words; accents and case do not matter.", at: "export function matchRanges(" },
      ],
      tests: ["src/lib/__tests__/search.test.ts", "src/lib/__tests__/searchScreens.test.ts", "src/lib/__tests__/sorting.test.ts", "e2e/search.spec.ts", "e2e/finding.spec.ts"],
    },
    {
      path: "src/components/DocList.tsx",
      role: "The list of all processes or all standards: search box, filter panel, cards or rows, order and pages.",
      requirements: [
        { text: "The address is the truth for the search, the filters, the order and the page.", at: "// the address is the truth; the app re-renders this page whenever it changes" },
        { text: "\"Only my bookmarks\" and \"Only what needs a review\" are kept for this tab (sessionStorage), not in the address.", at: "const [bookmarked, setBookmarked] = useRemembered(`pm:${list}:bookmarked`, false);" },
        { text: "Drafts are listed as the server sent them.", at: "catalog, q, filters, drafts: true, profile, flags," },
        { text: "Whoever may draft a document sees whether it needs fixing; whoever manages it where its review stands.", at: "const mayEdit = (d: Process | Standard) => canDraft(perms, kind, d);" },
      ],
      tests: ["e2e/lists.spec.ts", "e2e/paging.spec.ts", "e2e/cards.spec.ts"],
    },
    {
      path: "src/components/DocCard.tsx",
      role: "One process or standard in a list, as a card or as a row: kind, category, tiers, title, summary, facts, places found, marks, feedback, upvote and bookmark.",
      requirements: [
        { text: "The words found are marked by building elements from matchRanges, never as HTML.", at: "export function Marked({ text, words }: { text: string; words: string[] }) {" },
        { text: "\"Unpublished changes\" shows only for a published document whose meta carries a draft (sent only to who may work on it).", at: "const changes = !!meta?.draft && status !== \"draft\";" },
        { text: "A review overdue is a problem mark, a review due a warning mark.", at: "reviewOverdue(l.value) ? \"bad\" : \"warn\"" },
        { text: "Somebody who may fix a broken document is taken to its editing screen.", at: "export const docHref = (kind: TargetKind, id: string, fix = false) =>" },
      ],
      tests: ["e2e/cards.spec.ts", "e2e/browse.spec.ts"],
    },
    {
      path: "src/components/Lists.tsx",
      role: "The parts the lists and the search results share: search box, filter dropdowns and panel, type tabs, chosen filters, results bar, order, page size, pager.",
      requirements: [
        { text: "A filter value in a link that names nothing is dropped, the address replaced (no new history entry) and a notice shown once.", at: "export function useLinkFilters(" },
        { text: "A filter dropdown works with the keyboard: Enter, Space or the down arrow opens it, the arrows move, Escape closes and returns to the button.", at: "export function FilterDropdown({" },
        { text: "After going to another page, reading continues at the start of the results.", at: "export function toResults(el: HTMLElement | null) {" },
      ],
      tests: ["src/lib/__tests__/sorting.test.ts", "e2e/cards.spec.ts", "e2e/lists.spec.ts"],
    },
    {
      path: "src/components/SearchPage.tsx",
      role: "The search results: processes and standards together, by words, by meaning or both, with the type tabs, filters, order and pages in the address.",
      requirements: [
        { text: "By meaning and both, the server is asked only when the search is run; the answer is kept per query and per content.", at: "const meaning = useMeaningSearch(asked, needsServer(mode, asked, offered), attempt, stamp);" },
        { text: "Drafts are not searched by meaning: an editor is told to use Words or Both to find their drafts.", at: "Drafts are not searched by meaning." },
      ],
      tests: ["e2e/search.spec.ts", "e2e/meaning.spec.ts", "src/lib/__tests__/searchScreens.test.ts"],
    },
    {
      path: "src/lib/meaning.ts",
      role: "Search by meaning in the app: how the server's answer becomes cards, how Both puts two lists together, when the server is asked and what the page says.",
      requirements: [
        { text: "Each document once, in the server's order; a document the page does not have (a draft, something not visible to this person) is left out.", at: "export function fromMeaning(" },
        { text: "Both: reciprocal rank fusion with k = 60; a tie goes to the better single place, then to the word search.", at: "export function fuse(" },
        { text: "With Meaning and Both the address changes only when the search is run, so it always says what the results are for.", at: "export const typingMovesAddress =" },
        { text: "Answers are kept 2 minutes (at most 30); one request per query and content at a time.", at: "const KEEP_MS = 2 * 60 * 1000;" },
        { text: "404 means switched off, 429 busy, 503 not ready; anything else is \"not available right now\".", at: "export function problemOf(e: unknown): MeaningProblem {" },
      ],
      tests: ["src/lib/__tests__/meaning.test.ts", "src/lib/__tests__/finalF.test.ts", "e2e/meaning.spec.ts"],
    },
    {
      path: "src/components/HomePage.tsx",
      role: "Home: one search box, bookmarks, recently updated, most viewed, and ways in by platform, practice, team and category.",
      requirements: [
        { text: "Recently updated and Most viewed list published documents only, never a draft, whoever looks.", at: "const recent = useMemo(() => recentlyUpdated(out.results, meta, SHELF), [out, meta]);" },
        { text: "A new search is made in the mode the person chose last.", at: "const mode = me.search?.meaning ? rememberedMode(me.user?.email) : \"words\";" },
      ],
      tests: ["e2e/finding.spec.ts", "e2e/browse.spec.ts", "e2e/groups.spec.ts"],
    },
    {
      path: "src/lib/sorting.ts",
      role: "The order of the lists and the results (best match or name, newest, recently updated) and Home's short lists.",
      requirements: [
        { text: "By date, newest first, from meta createdAt or updatedAt; what has no date comes last, the same date goes by name.", at: "export function sortResults<T extends Sortable>(" },
        { text: "Home's short lists hold only what is published and in use.", at: "export const shownOnHome = (r: Listed) =>" },
        { text: "The order a person chose is remembered in this browser for that person; an order in the address wins.", at: "export function useRememberedSort(list: string, email?: string)" },
      ],
      tests: ["src/lib/__tests__/sorting.test.ts", "src/lib/__tests__/searchScreens.test.ts"],
    },
    {
      path: "src/lib/paging.ts",
      role: "Pages of a list: which items a page shows, which page numbers to offer, the page size and cards or rows.",
      requirements: [
        { text: "Pages of 12, 24 or 48; anything else is 24.", at: "export const PAGE_SIZES = [12, 24, 48] as const;" },
        { text: "A page past the end shows the last one; there is always at least one page.", at: "export function pageOf(total: number, page: number, size: number): Page {" },
      ],
      tests: ["src/lib/__tests__/lists.test.ts", "e2e/paging.spec.ts"],
    },
    {
      path: "src/lib/cardLines.ts",
      role: "What a card says about a process or standard: one fact per line, in a fixed order, only the lines that have something to say.",
      requirements: [
        { text: "The review line is shown only to whoever manages the document.", at: "if (f.mayEdit) add(\"review\", \"Review\", reviewLine(doc, f.today, f.dates), true);" },
        { text: "A process that does not say how binding it is says \"Not stated\", so every card has the same lines.", at: "export const RIGOUR_NOT_STATED = \"Not stated\";" },
      ],
      tests: ["src/lib/__tests__/lists.test.ts", "src/lib/__tests__/review.test.ts", "src/lib/__tests__/finalF.test.ts"],
    },
    {
      path: "src/lib/lifecycle.ts",
      role: "Status and review: when the owner must next confirm a process or standard is still correct.",
      requirements: [
        { text: "Every page decides \"needs a review\" with reviewOf: the first review counts from the first publication.", at: "export const reviewOf = (" },
        { text: "Due within 30 days.", at: "export const DUE_DAYS = 30;" },
        { text: "Never reviewed and no known publication date: overdue.", at: "if (!last && !isDate(start)) return { state: \"overdue\", label: \"Never reviewed\" };" },
        { text: "A stored review date that cannot be read never takes the page down: it counts as overdue.", at: "if (last && !isDate(last)) return { state: \"overdue\", label: \"Review date cannot be read\" };" },
      ],
      tests: ["src/lib/__tests__/review.test.ts", "src/lib/__tests__/demo.test.ts", "src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/components/ProcessPage.tsx",
      role: "The reader's page of a process: head, map, checklist, feedback and skills tabs, the open step in a side panel, Before you start.",
      requirements: [
        { text: "Nothing here changes the process: whoever may draft it gets Edit, which opens the editing screen.", at: "{drafts && <a className=\"btn primary\" href={editHref}><Pencil size={16} />Edit</a>}" },
        { text: "On a phone it opens on the checklist unless the address names a step.", at: "const to = arrivalTab(tab, item, !!window.matchMedia?.(PHONE).matches);" },
        { text: "A draft has no use line and records no view.", at: "{status !== \"draft\" && <DocEngagement kind=\"process\"" },
        { text: "Printed, a process is its checklist, whatever tab is open.", at: "{printing && <ListView process={doc}" },
        { text: "A process stored broken is not drawn; it is repaired on the editing screen.", at: "const renderable = useMemo(() => isDrawableProcess(doc), [doc]);" },
      ],
      tests: ["e2e/consumer.spec.ts", "e2e/map.spec.ts", "e2e/pages.spec.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/components/ListView.tsx",
      role: "The checklist of a process (each step with what to do, ticks for the reader) and the body of a step shared with the side panel.",
      requirements: [
        { text: "The ticks are the reader's own, kept in this browser (useProgress), never part of the process.", at: "export function ListView({" },
      ],
      tests: ["e2e/consumer.spec.ts"],
    },
    {
      path: "src/components/StepDrawer.tsx",
      role: "The side panel of a step on the reader's page: what to do, its open feedback, and a form to report a problem.",
      requirements: [
        { text: "A side panel, not a modal: focus moves in and back, Escape closes, Tab is free.", at: "useLayer(panel, onClose, { watch: step.id });" },
      ],
      tests: ["e2e/layout.spec.ts"],
    },
    {
      path: "src/components/Resources.tsx",
      role: "Links and skills that help to do the work, and their editor on the editing screen.",
      requirements: [
        { text: "Skills come first: they let an assistant do the work.", at: "export function Resources({ list, compact }" },
      ],
    },
    {
      path: "src/components/StandardPage.tsx",
      role: "The reader's page of a standard: head, requirements by level and by My application, feedback and skills tabs, the open requirement in a side panel.",
      requirements: [
        { text: "Printed, every requirement is shown, whatever level or application is chosen.", at: "const shown = doc.requirements.filter((r) => printing || !level || r.level === level);" },
        { text: "A draft has no use line and records no view.", at: "{status !== \"draft\" && <DocEngagement kind=\"standard\"" },
      ],
      tests: ["e2e/standards.spec.ts", "e2e/pages.spec.ts"],
    },
    {
      path: "src/components/Requirements.tsx",
      role: "One requirement as readers see it, and its fields on the editing screen.",
      requirements: [
        { text: "The words of the levels Must / Should / May, each with a hint of what it means.", at: "export const LEVEL: Record<Level, { label: string; hint: string }> = {" },
        { text: "On the reader's page a card has a button to report a problem; on the editing screen the card selects the requirement.", at: "export function RequirementCard({" },
      ],
      tests: ["e2e/standards.spec.ts"],
    },
    {
      path: "src/components/Governance.tsx",
      role: "The head of the reader's page (DocHead), where something applies, the review mark and line, the printed last line, and the governance fields of the editing screen.",
      requirements: [
        { text: "The same head for a process and a standard: kind tag, category and owner in ownedBy's words, marks, title, summary, facts, dates and version.", at: "export function DocHead({" },
        { text: "The printed last line says which version and when it was printed (printedLine).", at: "export function PrintFoot({ doc, meta }" },
        { text: "\"Content changed\" is written with formatDate.", at: "Content changed {formatDate(doc.updatedAt)}" },
      ],
      tests: ["e2e/pages.spec.ts", "src/lib/__tests__/readerPages.test.ts"],
    },
    {
      path: "src/components/ProcessSections.tsx",
      role: "The sections of a process on the editing screen other than its steps (About, Before you start, participants, links, standards), shared in part with standards.",
      requirements: [
        { text: "Each folded section says in a line what is set and opens by itself when the checker has a problem in it.", at: "export function GovernedSections<" },
      ],
      tests: ["e2e/editscreen.spec.ts"],
    },
    {
      path: "src/components/FlowView.tsx",
      role: "The swim-lane map of a process: on the reader's page, on the editing screen and (bare) in the Guide.",
      requirements: [
        { text: "The zoom rules come from src/lib/zoom.ts only.", at: "import { afterFit, fitWhole, hiddenEdges, isZoomWheel" },
        { text: "The blocks are one Tab stop: only the current block has tabIndex 0.", at: "tabIndex: tabStop === s.id ? 0 : -1" },
        { text: "The arrow keys, Home and End move between steps.", at: "const to = e.key === \"ArrowRight\" || e.key === \"ArrowDown\" ? at + 1" },
        { text: "The bare map (the Guide) uses the compact measures and neither zooms nor pans.", at: "const L = bare ? L_COMPACT : L_FULL;" },
      ],
      tests: ["e2e/map.spec.ts", "e2e/editor.spec.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/lib/zoom.ts",
      role: "The map's zoom rules: opening zoom, Fit, zoom with Ctrl + scroll, the lane column, centring a selected step.",
      requirements: [
        { text: "Opens at the larger of \"fits the width\" and \"fits the height\", in steps of 5%, never above 100%.", at: "export function openingZoom(" },
        { text: "Fit shows the whole flow, down to 10%.", at: "export function fitWhole(" },
        { text: "Fit lasts until a step is selected or the process is changed (back to the working zoom) or the buttons are used.", at: "export function afterFit(" },
        { text: "A selected step well inside the view stays where it is; otherwise it is scrolled to the middle.", at: "export function scrollToCentre(" },
        { text: "The lane names get a narrower column when the drawing is small.", at: "export function laneColumn(zoom: number, narrowScreen = false): number {" },
      ],
      tests: ["src/lib/__tests__/zoom.test.ts", "e2e/map.spec.ts"],
    },
    {
      path: "src/lib/layout.ts",
      role: "Lays a process out as swim lanes: one row per participant, time from left to right, loops found and drawn back.",
      requirements: [
        { text: "Back edges are found first, so that the columns follow only the forward flow.", at: "export function layoutProcess(p: Process, L: Dims = DEFAULT): Layout {" },
        { text: "Tighter measures for the small charts of the Guide (and the code map).", at: "export const L_COMPACT: typeof L =" },
      ],
      tests: ["src/lib/__tests__/layout.test.ts"],
    },
    {
      path: "src/components/GroupPage.tsx",
      role: "The page of a team, a platform or a practice: what it is, how to reach it, who is behind it, and what belongs to it.",
      requirements: [
        { text: "What belongs to it is found by the same search and drawn by the same cards as the lists.", at: "search({ processes, standards, catalog, filters, drafts: true })" },
        { text: "Details are changed only through /api/groups/… by whoever may (canChangeDetails).", at: "await putGroupDetails(kind, id, {" },
      ],
      tests: ["e2e/groups.spec.ts", "src/lib/__tests__/groups.test.ts"],
    },
    {
      path: "src/components/GroupParts.tsx",
      role: "Small parts that name a group elsewhere: its link, \"Owned by\" in ownedBy's words, the owner or member mark, its contact details.",
      requirements: [
        { text: "A link that leaves the portal opens in a new tab with rel=\"noopener noreferrer\".", at: "rel=\"noopener noreferrer\" title={v.form}" },
        { text: "The owner line keeps ownedBy's words exactly; only the team's name becomes a link.", at: "export function OwnedBy({ kind, doc }" },
      ],
      tests: ["e2e/groups.spec.ts"],
    },
    {
      path: "src/components/ContactFields.tsx",
      role: "The one place contact details of a group are edited (its page and Admin › Lists).",
      requirements: [
        { text: "A problem is shown on its own field in plain words once the field is left; links are checked with isWebLink.", at: "export function ContactFields({" },
      ],
      tests: ["e2e/groups.spec.ts"],
    },
    {
      path: "src/lib/groups.ts",
      role: "The rules of a group's page and of the rows of Teams & tools: what belongs to a group, contact details and their checks.",
      requirements: [
        { text: "Links people type are http or https only, at most 300 characters, as the schema and the server check them.", at: "export const isWebLink = (v: unknown): v is string =>" },
        { text: "A group's page lists what its search filter finds: a team what it owns, a platform or practice what names it.", at: "export const groupFilter = (" },
        { text: "Only a value that passes the check becomes a link; else the plain name, or nothing for a link alone.", at: "export function contactView(" },
      ],
      tests: ["src/lib/__tests__/groups.test.ts"],
    },
    {
      path: "src/lib/catalog.tsx",
      role: "Names from the lists, and how the head of a page says who looks after something.",
      requirements: [
        { text: "\"Cloud · Owned by Cloud Platform team\" / \"… · Issued by …\": one wording for the reader's page and the editing screen's preview.", at: "export const ownedBy = (c: Catalog, kind: \"process\" | \"standard\"" },
      ],
      tests: ["src/lib/__tests__/pageHead.test.ts"],
    },
    {
      path: "src/components/GuidePage.tsx",
      role: "The in-app Guide: the main documentation, with flow charts drawn by the map itself.",
      requirements: [
        { text: "A chart is the map, bare and not editable.", at: "<FlowView bare editable={false}" },
      ],
      tests: ["e2e/frame.spec.ts"],
    },
    {
      path: "src/guide/flows.ts",
      role: "The Guide's flow charts, written as ordinary processes.",
      requirements: [
        { text: "Each chart is a valid process (validate.test.ts checks them) drawn by the same map.", at: "export const followFlow = flow(" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts", "src/lib/__tests__/layout.test.ts"],
    },
    {
      path: "src/lib/engagement.tsx",
      role: "Views, bookmarks and upvotes in the app: loaded once, changed optimistically, the only way pages read them.",
      requirements: [
        { text: "An answer that set off before a click never undoes it; a change is dropped once a load that started after its confirmation is in.", at: "export function mergeLoaded(" },
        { text: "A view is recorded once per page load and document.", at: "const recordView = useCallback((kind: TargetKind, id: string) => {" },
        { text: "Pages read the numbers only through this hook.", at: "export const useEngagement = (): EngagementApi => useContext(EngagementContext);" },
      ],
      tests: ["src/lib/__tests__/engagement.test.ts", "e2e/engage.spec.ts"],
    },
    {
      path: "src/lib/known.ts",
      role: "Whether bookmarks and upvotes are known yet.",
      requirements: [
        { text: "Until loaded (or when refused), no number and no \"no bookmarks\" is shown as if it were a fact.", at: "export const engagementKnown = (eng: Known): boolean =>" },
      ],
    },
    {
      path: "src/components/Engage.tsx",
      role: "Upvote and bookmark buttons, the use and feedback line of a page, and what a reader can do with it (feedback, upvote, bookmark, share).",
      requirements: [
        { text: "Counts in words, never who: \"12 views by 5 people\".", at: "export function engagementLines(" },
        { text: "A view is recorded when the page is opened by a signed-in person.", at: "if (signedIn) eng.recordView(kind, id);" },
      ],
      tests: ["src/lib/__tests__/pageHead.test.ts", "e2e/engage.spec.ts"],
    },
    {
      path: "src/components/ShareDialog.tsx",
      role: "Sharing a process or standard: copy the link, the link with its title, an e-mail, or the device's share sheet.",
      requirements: [
        { text: "Nothing is sent from the app; where copying is not allowed, the text is shown to copy by hand.", at: "Nothing is posted for you." },
      ],
      tests: ["src/lib/__tests__/share.test.ts", "e2e/engage.spec.ts"],
    },
    {
      path: "src/lib/share.ts",
      role: "The words and addresses of sharing.",
      requirements: [
        { text: "The shared address is the document itself, not the tab or step that is open.", at: "export function shareUrl(base: string, kind: TargetKind, id: string): string {" },
        { text: "An e-mail link with subject and text encoded, spaces as %20.", at: "export function mailtoLink(" },
      ],
      tests: ["src/lib/__tests__/share.test.ts"],
    },
    {
      path: "src/components/Feedback.tsx",
      role: "Feedback on a process or standard: the form, one piece of feedback, and the feedback tab.",
      requirements: [
        { text: "Three clicks: what kind, a sentence, send; who gave it comes from the sign-in.", at: "export function FeedbackForm({" },
        { text: "Mark as fixed and Reopen only where the server says the person may (canManage on the item).", at: "{item.canManage && (" },
      ],
      tests: ["e2e/feedback.spec.ts", "src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/components/SkillPanel.tsx",
      role: "The Skills tab: the generated skill and review agent of a process or standard, their versions, download and extra guidance.",
      requirements: [
        { text: "Downloads go through the server, which counts them.", at: "/api/skills/${skill.id}/download" },
        { text: "Shows the skills the server lists for this document, reloaded when it is saved; with none it says that drafts and retired documents have no skill.", at: "export function SourceSkills({ kind, id, revision }" },
      ],
      tests: ["src/lib/__tests__/readerPages.test.ts", "e2e/skills.spec.ts"],
    },
    {
      path: "src/components/Library.tsx",
      role: "The Processes page: its heading, the buttons to create one, and the list.",
      requirements: [
        { text: "New process and Create from text with AI only for whoever may create a process.", at: "const editor = canCreate(perms, \"process\");" },
      ],
    },
    {
      path: "src/components/StandardsLibrary.tsx",
      role: "The Standards page: its heading, the buttons to create one, and the list.",
      requirements: [
        { text: "New standard and Create from text with AI only for whoever may create a standard.", at: "const editor = canCreate(perms, \"standard\");" },
      ],
    },
    {
      path: "src/lib/selection.ts",
      role: "The open step or requirement of a reader's page, kept in the address.",
      requirements: [
        { text: "Back closes what was opened, and never opens again what was closed.", at: "export function useSelectedItem(" },
      ],
    },
  ],
};
