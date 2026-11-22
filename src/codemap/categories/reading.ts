import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const reading: CodeCategory = {
  id: "reading",
  area: "app",
  title: "Reading and finding",
  summary: "What readers use to find and read: Home, the lists, the search results, the pages of a process, a standard and a group, and the Guide. The three lists share one search (`search()` in `src/lib/search.ts`) and one card (`DocCard`); the map is drawn by one component (`FlowView`) with one set of zoom rules (`src/lib/zoom.ts`). Views, bookmarks and upvotes are read through `useEngagement`; when a review is due is decided by `reviewOf`.",
  requirements: [
    "The Processes list, the Standards list and the search results use the same `search()` and `DocCard`; a filter, a searched field or the card is changed there once, not per page.",
    "The word search finds a document only when every word of the query is in it somewhere; case and accents do not matter. Several values of one filter mean any of them, different filters all of them.",
    "The app shows every draft the server sends (`search()` is called with `drafts: true`). Hiding a draft from whoever may not see it is enforced by `canSee` in `listDocs` (`server/internal/httpapi/content.go`); the index behind `GET /api/search` holds no draft at all.",
    "A result of search by meaning that is not among the documents the page has is dropped (`fromMeaning`), so the server's answer can never show something the person may not see.",
    "A filter value in an address that names nothing that exists is dropped, the address corrected in place and a notice shown once (`useLinkFilters` with `knownFilters`).",
    "Whether a review is due is decided by `reviewOf` / `needsReview` on every page: from the last review, or for one never reviewed from its first publication (`meta.publishedAt`); due within 30 days is a warning, past the date a problem. The MCP server decides the same in its own `reviewOf`.",
    "Views, bookmarks, upvotes and downloads are read only through `useEngagement`; they are counts, never who; while they are not known no number is shown, because a 0 would look like a fact.",
    "A view is recorded once per page load and document, never for a draft; the server counts the same person once a day (`document_views`).",
    "The reader's page changes nothing: it offers Edit (to whoever may draft) and Mark as reviewed (to whoever may edit it or owns its team); every change happens on the editing screen.",
    "The map's zoom rules are one module (`src/lib/zoom.ts`) for the reader's map, the editing map and the Guide's charts; the blocks are one Tab stop and the arrow keys move between steps.",
  ],
  charts: [
    {
      caption: "A search on the results page. By words it runs in the browser as the person types; by meaning (or both) the server is asked only when the search is run, answers are kept for 2 minutes, and only documents the page already has are shown.",
      process: flow("code-reading-search", "A search, by words or by meaning", "From typed words to cards on the results page.",
        [["reader", "Reader"], ["browser", "Browser"], ["server", "Server"]],
        [
          s("type", "Type words, press Enter", "reader", "task", ["mode"], "the address follows"),
          s("mode", "Searching by words?", "browser", "decision", [["words", "Words"], ["ask", "Meaning or Both"]]),
          s("ask", "Ask for the closest ones", "browser", "communication", ["rank"], "GET /api/search"),
          s("rank", "Rank published parts by meaning", "server", "automation", ["keep"], "the index has no draft"),
          s("keep", "Drop what the page does not have", "browser", "verify", ["filter"], "fromMeaning; Both: fuse"),
          s("words", "Find every word, score the fields", "browser", "automation", ["filter"], "title 100 … inside 5"),
          s("filter", "Filter, sort and cut into pages", "browser", "automation", ["cards"], "counts per option"),
          s("cards", "Draw the cards with places found", "browser", "automation", [], "DocCard, Marked"),
        ]),
    },
    {
      caption: "`reviewInfo` in `src/lib/lifecycle.ts`, as every page calls it through `reviewOf`. A stored review date that cannot be read also counts as overdue.",
      process: flow("code-reading-review", "When a review is due", "How the review state of a process or standard is decided.",
        [["browser", "Browser"]],
        [
          s("planned", "Active, with an interval?", "browser", "decision", [["none", "No"], ["last", "Yes"]]),
          s("none", "Say: no review planned", "browser", "automation", []),
          s("last", "Reviewed before?", "browser", "decision", [["due", "Yes"], ["published", "No"]], "lastReviewedAt"),
          s("published", "First publication known?", "browser", "decision", [["due", "Yes"], ["overdue", "No"]], "publishedAt, else createdAt"),
          s("due", "How many days are left?", "browser", "decision", [["overdue", "Below 0"], ["soon", "30 or fewer"], ["ok", "More"]], "interval in months added"),
          s("overdue", "Mark overdue, as a problem", "browser", "automation", []),
          s("soon", "Mark due, as a warning", "browser", "automation", []),
          s("ok", "Show the next date quietly", "browser", "automation", []),
        ]),
    },
    {
      caption: "Opening the reader's page of a process from a link. The map then opens at the larger of \"fits the width\" and \"fits the height\" (`openingZoom`).",
      process: flow("code-reading-open", "Opening a process page", "From a link to the map on screen.",
        [["reader", "Reader"], ["browser", "Browser"], ["server", "Server"]],
        [
          s("open", "Open a link to a process", "reader", "task", ["phone"], "#/p/:id/flow/:step"),
          s("phone", "A phone, the map without a step?", "browser", "decision", [["list", "Yes"], ["draft", "No"]]),
          s("list", "Switch to the checklist in place", "browser", "automation", ["draft"], "arrivalTab"),
          s("draft", "Is it a draft?", "browser", "decision", [["show", "Yes"], ["view", "No"]]),
          s("view", "Record one view", "browser", "communication", ["count"], "once per page load"),
          s("count", "Count the person once a day", "server", "document", ["show"], "document_views"),
          s("show", "Draw the head, the tabs and the map", "browser", "automation", [], "DocHead, FlowView"),
        ]),
    },
  ],
  examples: [
    {
      title: "One address through the Processes list",
      caption: "The sample process `request-gcp-project`, found from a shared link to the Processes list.",
      stages: [
        { label: "The address", shape: "#/processes?q=gcp%20project&platform=google-cloud&sort=updated&page=1", note: "Shared, reloaded or come back to with Back: the list is the same." },
        { label: "Read by parseRoute", where: "src/lib/store.ts", shape: "{ \"page\": \"library\", \"q\": \"gcp project\", \"platform\": [\"google-cloud\"], \"sort\": \"updated\", \"pageNo\": 1 }", note: "Written back by `href`, page 1 is left out: #/processes?q=gcp%20project&platform=google-cloud&sort=updated" },
        { label: "Searched by search()", where: "src/lib/search.ts", shape: "{\n  \"kind\": \"process\", \"id\": \"request-gcp-project\", \"score\": 225,\n  \"rigour\": { \"mandatory\": 1 }, \"rules\": 0,\n  \"hits\": [\n    { \"where\": \"step\", \"item\": \"raise-request\", \"label\": \"Raise the 'New GCP project' request\" },\n    { \"where\": \"step\", \"item\": \"verify-access\", \"label\": \"Check you can open the project\" },\n    { \"where\": \"prerequisite\", \"label\": \"Google group for your team\",\n      \"snippet\": \"The group becomes owner of the project, e.g. gcp-myteam-admins@example.com.\" }\n  ]\n}", note: "Both words are in the title (100 each) and the title contains the phrase (+25). The platform filter offers Google Cloud with count 1, chosen." },
        { label: "Paged by pageOf", where: "src/lib/paging.ts", shape: "{ \"page\": 1, \"pages\": 1, \"first\": 1, \"last\": 1, \"total\": 1, \"start\": 0, \"end\": 1 }", note: "One result: the bar says \"1 process\", no pager." },
        { label: "Lines of the card", where: "src/lib/cardLines.ts", shape: "[\n  { \"key\": \"owner\", \"name\": \"Owner\", \"value\": \"Cloud Platform team\" },\n  { \"key\": \"platform\", \"name\": \"Platform\", \"value\": \"Google Cloud\" },\n  { \"key\": \"rigour\", \"name\": \"Rigour\", \"value\": \"Mandatory\" },\n  { \"key\": \"lead\", \"name\": \"Lead time\", \"value\": \"3-5 working days\" },\n  { \"key\": \"steps\", \"name\": \"Steps\", \"value\": \"5 of 10 are yours\" }\n]", note: "Reviewed on 2026-11-03 every 6 months: next review 2027-05-03, so an editor sees no review mark yet." },
      ],
    },
  ],
  start: "src/lib/search.ts",
  files: [
    // ---- the shared search and card
    {
      path: "src/lib/search.ts",
      role: "The one search over processes and standards: words, filters, counts per option, My application, and the marking of the words found.",
      requirements: [
        { text: "A word found nowhere makes the score 0 and drops the document: every word must match. A field added to the chunk text for search by meaning must also be added here, or the two searches find different things.", at: "if (!best) return 0;" },
        { text: "The count of an option is worked out with its own filter skipped, so choosing one platform still shows how many each other platform would give.", at: "return k === skip || !chosen?.length || d.values[k].some((v) => (chosen as string[]).includes(v));" },
        { text: "A draft is listed only when the caller allows it; the pages pass `true` because the server already left out what the person may not see.", at: "(d.status !== \"draft\" || (typeof drafts === \"function\" ? drafts(kind, d) : drafts)) && appliesTo(d, profile);" },
        { text: "A value counts as existing when the lists have it or a document uses it, so a list entry removed but still used stays findable (under its id) and can be fixed.", at: "export function knownFilters(" },
        { text: "Words of one or two letters are marked only where they stand alone; inside other words they would mark fragments everywhere.", at: "if (w.length < SHORT_WORD && (inWord(at - 1) || inWord(endNorm))) continue;" },
      ],
      tests: ["src/lib/__tests__/search.test.ts", "src/lib/__tests__/searchScreens.test.ts", "e2e/search.spec.ts", "e2e/finding.spec.ts"],
    },
    {
      path: "src/components/DocCard.tsx",
      role: "One process or standard in a list, as a card or as a row: kind, category, tiers, title, summary, facts, places found, marks, feedback, upvote and bookmark.",
      requirements: [
        { text: "Marked words are React elements around slices of the text, never HTML: a title containing markup stays text.", at: "className=\"search-mark\">{text.slice(a, b)}</mark>" },
        { text: "\"Unpublished changes\" shows only when `meta.draft` is set, which the server sends only to people with `CanDraft` (`listDocs`); here it is only shown.", at: "const changes = !!meta?.draft && status !== \"draft\";" },
        { text: "An overdue review is a problem mark, a due one a warning mark (the vocabulary of CLAUDE.md).", at: "reviewOverdue(l.value) ? \"bad\" : \"warn\"" },
      ],
      tests: ["e2e/cards.spec.ts", "e2e/browse.spec.ts"],
    },
    {
      path: "src/components/Lists.tsx",
      role: "The parts the lists and the search results share: search box, filter dropdowns and panel, type tabs, chosen filters, results bar, order, page size, pager.",
      requirements: [
        { text: "Filters of a link are checked only once the lists are loaded (`ready`); before that every value would look unknown and be dropped from the address.", at: "if (ready && checked.dropped) { setNoticeFor(kept); correct(checked.filters); }" },
      ],
      tests: ["src/lib/__tests__/sorting.test.ts", "e2e/cards.spec.ts", "e2e/lists.spec.ts"],
    },
    // ---- the lists and the search results
    {
      path: "src/components/DocList.tsx",
      role: "The list of all processes or all standards: search box, filter panel, cards or rows, order and pages.",
      requirements: [
        { text: "The list is read from the address on every render, so a shared link, a reload and Back show the same list.", at: "const route = parseRoute(location.hash) as ListState & { page: string };" },
        { text: "A size or order in the address wins over the one this person chose last in this browser.", at: "const size = state.size ? sizeOf(state.size) : mySize;" },
        { text: "\"Only my bookmarks\" and \"Only what needs a review\" are kept for the tab, not in the address: a shared link does not carry them.", at: "const [bookmarked, setBookmarked] = useRemembered(`pm:${list}:bookmarked`, false);" },
      ],
      tests: ["e2e/lists.spec.ts", "e2e/paging.spec.ts", "e2e/cards.spec.ts"],
    },
    {
      path: "src/components/Library.tsx",
      role: "The Processes page: its heading, the buttons to create one, and the list.",
      requirements: [
        { text: "The buttons to create appear by `canCreate`; creating is refused by the server for anybody else anyway.", at: "const editor = canCreate(perms, \"process\");" },
      ],
    },
    {
      path: "src/components/StandardsLibrary.tsx",
      role: "The Standards page: its heading, the buttons to create one, and the list.",
      requirements: [
        { text: "The buttons to create appear by `canCreate`; creating is refused by the server for anybody else anyway.", at: "const editor = canCreate(perms, \"standard\");" },
      ],
    },
    {
      path: "src/components/SearchPage.tsx",
      role: "The search results: processes and standards together, by words, by meaning or both, with the type tabs, filters, order and pages in the address.",
      requirements: [
        { text: "By meaning and both, the server is asked only when the search is run, and an answer is reused only for the same content (`contentStamp`): after a save the next search asks again.", at: "const meaning = useMeaningSearch(asked, needsServer(mode, asked, offered), attempt, stamp);" },
        { text: "Drafts are never in the index, so an editor searching by meaning is told to use Words or Both to find their drafts.", at: "Drafts are not searched by meaning." },
      ],
      tests: ["e2e/search.spec.ts", "e2e/meaning.spec.ts", "src/lib/__tests__/searchScreens.test.ts"],
    },
    {
      path: "src/lib/meaning.ts",
      role: "Search by meaning in the app: how the server's answer becomes cards, how Both puts two lists together, when the server is asked and what the page says.",
      requirements: [
        { text: "A document the page does not have (a draft, something not visible to this person) is skipped, and each document is taken once.", at: "if (!doc || seen.has(key)) continue;" },
        { text: "Both adds 1 / (60 + place) from each list (reciprocal rank fusion): being high in either list counts, being in both counts more.", at: "const part = 1 / (k + i + 1);" },
        { text: "A 404 means search by meaning was switched off while the page was open; the page then falls back to words instead of showing an error.", at: "if (status === 404) return { kind: \"off\", message };" },
      ],
      tests: ["src/lib/__tests__/meaning.test.ts", "src/lib/__tests__/finalF.test.ts", "e2e/meaning.spec.ts"],
    },
    {
      path: "src/lib/sorting.ts",
      role: "The order of the lists and the results (best match or name, newest, recently updated) and Home's short lists.",
      requirements: [
        { text: "By date, what has no date comes last and the same date goes by name, so the order is the same on every load.", at: "export function sortResults<T extends Sortable>(" },
        { text: "Home's short lists hold only published documents in use: a draft never appears there, also not for its editors.", at: "export const shownOnHome = (r: Listed) =>" },
      ],
      tests: ["src/lib/__tests__/sorting.test.ts", "src/lib/__tests__/searchScreens.test.ts"],
    },
    {
      path: "src/lib/paging.ts",
      role: "Pages of a list: which items a page shows, which page numbers to offer, the page size and cards or rows.",
      requirements: [
        { text: "A size other than 12, 24 or 48 (an old or edited value) becomes 24.", at: "export const sizeOf = (n: unknown): number =>" },
        { text: "A page past the end shows the last one, so a link to page 5 of a list that shrank still shows results.", at: "const p = Math.min(pages, Math.max(1, Math.floor(page) || 1));" },
      ],
      tests: ["src/lib/__tests__/lists.test.ts", "e2e/paging.spec.ts"],
    },
    {
      path: "src/lib/cardLines.ts",
      role: "What a card says about a process or standard: one fact per line, in a fixed order, only the lines that have something to say.",
      requirements: [
        { text: "The review line is added only for whoever manages the document; readers never see review dates on cards.", at: "if (f.mayEdit) add(\"review\", \"Review\", reviewLine(doc, f.today, f.dates), true);" },
      ],
      tests: ["src/lib/__tests__/lists.test.ts", "src/lib/__tests__/review.test.ts"],
    },
    {
      path: "src/components/HomePage.tsx",
      role: "Home: one search box, bookmarks, recently updated, most viewed, and ways in by platform, practice, team and category.",
      requirements: [
        { text: "Most viewed is drawn only once the numbers are known; before that it is left out instead of showing an empty or wrong list.", at: "const viewed = known ? mostViewed(" },
      ],
      tests: ["e2e/finding.spec.ts", "e2e/browse.spec.ts", "e2e/groups.spec.ts"],
    },
    // ---- the reader's page of a process
    {
      path: "src/components/ProcessPage.tsx",
      role: "The reader's page of a process: head, map, checklist, feedback and skills tabs, the open step in a side panel, Before you start.",
      requirements: [
        { text: "Edit appears by `canDraft`, so members of its platform or practice get it too (they save drafts, an owner publishes); the server refuses everyone else.", at: "{drafts && <a className=\"btn primary\" href={editHref}><Pencil size={16} />Edit</a>}" },
        { text: "A draft has no use line, so no view of a draft is ever recorded.", at: "{status !== \"draft\" && <DocEngagement kind=\"process\"" },
        { text: "Printed, the page is the checklist with every step, whatever tab is open.", at: "{printing && <ListView process={doc}" },
        { text: "A process stored broken is not drawn (the map would fail); whoever may draft it gets a link to repair it.", at: "const renderable = useMemo(() => isDrawableProcess(doc), [doc]);" },
      ],
      tests: ["e2e/consumer.spec.ts", "e2e/map.spec.ts", "e2e/pages.spec.ts"],
    },
    {
      path: "src/components/FlowView.tsx",
      role: "The swim-lane map of a process: on the reader's page, on the editing screen and (bare) in the Guide.",
      requirements: [
        { text: "Only the current block has `tabIndex` 0: the map is one Tab stop, so Tab leaves it at once however many steps it has.", at: "tabIndex: tabStop === s.id ? 0 : -1" },
        { text: "The arrow keys, Home and End move between steps in the order of the flow.", at: "const to = e.key === \"ArrowRight\" || e.key === \"ArrowDown\" ? at + 1" },
        { text: "The bare map (the Guide) uses the compact measures and neither zooms nor pans: no wheel or drag handler is installed for it.", at: "const L = bare ? L_COMPACT : L_FULL;" },
      ],
      tests: ["e2e/map.spec.ts", "e2e/editor.spec.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/lib/zoom.ts",
      role: "The map's zoom rules: opening zoom, Fit, zoom with Ctrl + scroll, the lane column, centring a selected step.",
      requirements: [
        { text: "The map opens at the larger of \"fits the width\" and \"fits the height\", so a long flow opens readable and scrolls sideways instead of shrinking to boxes.", at: "return Math.max(byWidth, byHeight);" },
        { text: "Fit may go down to 10%, below the usual 40%; zooming out from there goes no further.", at: "export const ZOOM_FLOOR = 0.1;" },
        { text: "Fit is temporary: selecting a step or changing the process returns to the working zoom.", at: "return { fitted: false, zoom: state.working };" },
        { text: "One wheel event never changes the zoom by more than a quarter, whatever the device sends.", at: "const step = Math.max(-0.25, Math.min(0.25, -px * 0.001));" },
      ],
      tests: ["src/lib/__tests__/zoom.test.ts", "e2e/map.spec.ts"],
    },
    {
      path: "src/lib/layout.ts",
      role: "Lays a process out as swim lanes: one row per participant, time from left to right, loops found and drawn back.",
      requirements: [
        { text: "Loops are found first (a depth-first search marks back edges), so a step that leads back does not push the columns to the right forever.", at: "if (state[j] === 1) back.add(`${i}>${j}`);" },
      ],
      tests: ["src/lib/__tests__/layout.test.ts"],
    },
    {
      path: "src/components/ListView.tsx",
      role: "The checklist of a process (each step with what to do, ticks for the reader) and the body of a step shared with the side panel.",
      requirements: [
        { text: "A tick only changes `done` from `useProgress`, kept in this browser; nothing is sent to the server and the process is never changed.", at: "aria-label={`Mark as done: ${s.title}`}" },
      ],
      tests: ["e2e/consumer.spec.ts"],
    },
    {
      path: "src/components/StepDrawer.tsx",
      role: "The side panel of a step on the reader's page: what to do, its open feedback, and a form to report a problem.",
      requirements: [
        { text: "A side panel, not a modal: Tab may leave it; `watch` moves focus into it again when another step is opened.", at: "useLayer(panel, onClose, { watch: step.id });" },
      ],
      tests: ["e2e/layout.spec.ts"],
    },
    {
      path: "src/components/Resources.tsx",
      role: "Links and skills that help to do the work, and their editor on the editing screen.",
      requirements: [
        { text: "Skills are listed first, because they let an assistant do the work.", at: "export function Resources({ list, compact }" },
      ],
    },
    // ---- the reader's page of a standard
    {
      path: "src/components/StandardPage.tsx",
      role: "The reader's page of a standard: head, requirements by level and by My application, feedback and skills tabs, the open requirement in a side panel.",
      requirements: [
        { text: "Printed, every requirement is shown, whatever level or application is chosen on screen.", at: "const shown = doc.requirements.filter((r) => printing || !level || r.level === level);" },
        { text: "A draft has no use line, so no view of a draft is ever recorded.", at: "{status !== \"draft\" && <DocEngagement kind=\"standard\"" },
      ],
      tests: ["e2e/standards.spec.ts", "e2e/pages.spec.ts"],
    },
    {
      path: "src/components/Requirements.tsx",
      role: "One requirement as readers see it, and its fields on the editing screen.",
      requirements: [
        { text: "On the reader's page a card only reports a problem; on the editing screen (`onSelect`) the same card selects the requirement for its fields.", at: "export function RequirementCard({" },
      ],
      tests: ["e2e/standards.spec.ts"],
    },
    // ---- shared by both pages
    {
      path: "src/components/Governance.tsx",
      role: "The head of the reader's page (`DocHead`), where something applies, the review mark and line, the printed last line, and the governance fields of the editing screen.",
      requirements: [
        { text: "The printed address is cut back to the document itself (`#/p/:id`, `#/s/:id`), not the tab or step that was open.", at: "replace(/^(#\\/[ps]\\/[a-z0-9-]+).*$/, \"$1\")" },
        { text: "\"Content changed\" is written with `formatDate`, so a plain date is never shifted by the time zone.", at: "Content changed {formatDate(doc.updatedAt)}" },
      ],
      tests: ["e2e/pages.spec.ts", "src/lib/__tests__/readerPages.test.ts"],
    },
    {
      path: "src/lib/lifecycle.ts",
      role: "Status and review: when the owner must next confirm a process or standard is still correct.",
      requirements: [
        { text: "Never reviewed and no known first publication: overdue at once, since nobody knows how long it went unreviewed.", at: "if (!last && !isDate(start)) return { state: \"overdue\", label: \"Never reviewed\" };" },
        { text: "A stored review date that cannot be read counts as overdue instead of taking the page down.", at: "if (last && !isDate(last)) return { state: \"overdue\", label: \"Review date cannot be read\" };" },
        { text: "Days are counted between UTC days (`today` from `toISOString`), as the MCP server counts them; not the reader's local day.", at: "export function reviewInfo(" },
      ],
      tests: ["src/lib/__tests__/review.test.ts", "src/lib/__tests__/demo.test.ts"],
    },
    {
      path: "src/components/ProcessSections.tsx",
      role: "The sections of a process on the editing screen other than its steps (About, Before you start, participants, links, standards), shared in part with standards.",
      requirements: [
        { text: "A folded section opens by itself when the checker flags a field in it, so a problem is never hidden in a closed section.", at: "const flaggedKeys = (issues: Issue[]) =>" },
      ],
      tests: ["e2e/editscreen.spec.ts"],
    },
    // ---- use, sharing, feedback, skills
    {
      path: "src/lib/engagement.tsx",
      role: "Views, bookmarks and upvotes in the app: loaded once, changed optimistically, the only way pages read them.",
      requirements: [
        { text: "A change made here is laid over every load until a load that started after the server confirmed it comes back; without it, an answer that set off before a click would undo the click.", at: "const keep = changes.filter((c) => c.settled === null || load <= c.settled);" },
        { text: "A view is sent once per page load and document; tabs, re-renders and coming back do not send it again.", at: "if (seen.current.has(k)) return;" },
        { text: "A refused bookmark is taken back on screen and the person is told; the screen never shows a bookmark the server does not have.", at: "undo(key, (d) => withBookmark(d, kind, id, !on));" },
      ],
      tests: ["src/lib/__tests__/engagement.test.ts", "e2e/engage.spec.ts"],
    },
    {
      path: "src/lib/known.ts",
      role: "Whether bookmarks and upvotes are known yet.",
      requirements: [
        { text: "Known means loaded and not refused; until then the pages show no number and \"Only my bookmarks\" waits.", at: "export const engagementKnown = (eng: Known): boolean =>" },
      ],
    },
    {
      path: "src/components/Engage.tsx",
      role: "Upvote and bookmark buttons, the use and feedback line of a page, and what a reader can do with it (feedback, upvote, bookmark, share).",
      requirements: [
        { text: "Numbers only (\"12 views by 5 people\"): the server answers counts, and nothing here could name who viewed.", at: "export function engagementLines(" },
        { text: "A view is recorded only for a signed-in person.", at: "if (signedIn) eng.recordView(kind, id);" },
      ],
      tests: ["src/lib/__tests__/pageHead.test.ts", "e2e/engage.spec.ts"],
    },
    {
      path: "src/components/ShareDialog.tsx",
      role: "Sharing a process or standard: copy the link, the link with its title, an e-mail, or the device's share sheet.",
      requirements: [
        { text: "Where the browser does not allow copying, the text is shown selected to copy by hand, instead of failing silently.", at: "setCopied(null); setManual({ what, text });" },
      ],
      tests: ["e2e/engage.spec.ts"],
    },
    {
      path: "src/lib/share.ts",
      role: "The words and addresses of sharing.",
      requirements: [
        { text: "Any `#…` or `?…` of the current address is cut off: the shared link points at the document, not the tab or step open.", at: "const root = base.replace(/[#?].*$/, \"\");" },
      ],
      tests: ["src/lib/__tests__/share.test.ts"],
    },
    {
      path: "src/components/Feedback.tsx",
      role: "Feedback on a process or standard: the form, one piece of feedback, and the feedback tab.",
      requirements: [
        { text: "Mark as fixed and Reopen appear only when the server marked the item `canManage`; the app works out no right of its own here.", at: "{item.canManage && (" },
      ],
      tests: ["e2e/feedback.spec.ts"],
    },
    {
      path: "src/components/SkillPanel.tsx",
      role: "The Skills tab: the generated skill and review agent of a process or standard, their versions, download and extra guidance.",
      requirements: [
        { text: "Download is a link to the server, which counts it; a copy made with Copy is not counted.", at: "/api/skills/${skill.id}/download" },
      ],
      tests: ["src/lib/__tests__/readerPages.test.ts", "e2e/skills.spec.ts"],
    },
    // ---- the pages of a team, platform or practice
    {
      path: "src/components/GroupPage.tsx",
      role: "The page of a team, a platform or a practice: what it is, how to reach it, who is behind it, and what belongs to it.",
      requirements: [
        { text: "What belongs to it is found by the same `search()` with the group's filter, so the page and \"Show in the search\" always agree.", at: "search({ processes, standards, catalog, filters, drafts: true })" },
        { text: "Details are saved only through `/api/groups/…`, where `server/internal/httpapi/groups.go` checks who may change them; `canChangeDetails` here only shows the button.", at: "await putGroupDetails(kind, id, {" },
      ],
      tests: ["e2e/groups.spec.ts", "src/lib/__tests__/groups.test.ts"],
    },
    {
      path: "src/components/GroupParts.tsx",
      role: "Small parts that name a group elsewhere: its link, \"Owned by\" in `ownedBy`'s words, the owner or member mark, its contact details.",
      requirements: [
        { text: "Every link that leaves the portal opens in a new tab with `rel=\"noopener noreferrer\"`, so the other site cannot reach this window.", at: "rel=\"noopener noreferrer\" title={v.form}" },
      ],
      tests: ["e2e/groups.spec.ts"],
    },
    {
      path: "src/components/ContactFields.tsx",
      role: "The one place contact details of a group are edited (its page and Admin › Lists).",
      requirements: [
        { text: "A link typed without its beginning gets `https://` when the field is left; anything with another scheme is left for the check to refuse.", at: "if (LINK_KEYS.includes(r.key)) { const v = withScheme(e.target.value);" },
      ],
      tests: ["e2e/groups.spec.ts"],
    },
    {
      path: "src/lib/groups.ts",
      role: "The rules of a group's page and of the rows of Teams & tools: what belongs to a group, contact details and their checks.",
      requirements: [
        { text: "Only `http(s)` links of at most 300 characters are links; the schema (`$defs/contacts`) and the server (`docs/contacts.go`) check the same, so a `javascript:` link can never be drawn.", at: "export const isWebLink = (v: unknown): v is string =>" },
        { text: "A Slack or Chat link that fails the check is dropped, and the plain name shown instead.", at: "const link = isWebLink(url) ? url!.trim() : undefined;" },
      ],
      tests: ["src/lib/__tests__/groups.test.ts"],
    },
    {
      path: "src/lib/catalog.tsx",
      role: "Names from the lists, and how the head of a page says who looks after something.",
      requirements: [
        { text: "One wording (\"Cloud · Owned by Cloud Platform team\") for the reader's page and the editing screen's preview; `OwnedBy` only turns the team's name into a link.", at: "export const ownedBy = (c: Catalog, kind: \"process\" | \"standard\"" },
      ],
      tests: ["src/lib/__tests__/pageHead.test.ts"],
    },
    // ---- the Guide
    {
      path: "src/components/GuidePage.tsx",
      role: "The in-app Guide: the main documentation, with flow charts drawn by the map itself.",
      requirements: [
        { text: "A chart is the map itself, bare and not editable, so the Guide's charts look exactly like a process.", at: "<FlowView bare editable={false}" },
      ],
      tests: ["e2e/frame.spec.ts"],
    },
    {
      path: "src/guide/flows.ts",
      role: "The Guide's flow charts, written as ordinary processes.",
      requirements: [
        { text: "Each chart must be a valid process: `validate.test.ts` checks them like stored content.", at: "export const followFlow = flow(" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts", "src/lib/__tests__/layout.test.ts"],
    },
  ],
};
