import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const frame: CodeCategory = {
  id: "frame",
  area: "app",
  title: "The frame of the app",
  summary: "The start of the React app, its routes in the address, and the one path every call to the server takes. `main.tsx` and `App.tsx` load the look, ask who is signed in, load the content once and draw the page of the route; `src/lib/store.ts` holds every call to the server, the parsing and writing of addresses, and the guard that asks before unsaved changes are lost. It also holds the signed-in person's rights (only for showing controls), media queries and printing, and how dates are written.",
  requirements: [
    "Every call to the server goes through `request()` in `src/lib/store.ts`, which adds `X-Requested-With: process-manager` to every method but GET; the server's guard (`CSRFHeader` in `server/internal/httpapi/api.go`) answers 403 to a change without it.",
    "A 401 on any path but `/api/me` raises the window event `pm:signed-out`; the app shows `SignedOutDialog` on top and keeps the page, unsaved changes included. Nothing navigates away on its own.",
    "A 409 with a conflict in its body is thrown as an `ApiError` whose `conflict` says who saved first; a server that cannot be reached is an `ApiError` with status 0 saying, for a change, that nothing was saved.",
    "Routing is the hash only: `parseRoute` reads it, `href` writes it, an unknown address falls back to Home. The reader's page and the editing screen are different routes (`#/p/:id/…`, `#/p/:id/edit`).",
    "Leaving a place with unsaved changes asks first, whether by a link, Back or Forward, a typed address, signing out or closing the tab; Back and Forward are undone while asking, so the history is the same whatever the answer.",
    "The places of the top bar are one list (`places` in `App.tsx`) used by the desktop bar and the Menu that replaces it below 1120 pixels.",
    "An answer of the server that was on its way while this tab saved something is dropped (the `writes` counter in `Shell`), so it never puts older content back on screen.",
    "The search, the filters of the panel, a chosen order, the page and a chosen page size are in the address (`ListState`, `SearchState`); \"Only my bookmarks\" and \"Only what needs a review\" are kept for the tab (sessionStorage), My application in this browser (localStorage).",
    "Browser storage holds only per-person conveniences (such as My application, the last page size, order and search mode, cards or rows, checklist ticks, the last look, light or dark), each read and written in try/catch.",
    "Rights in the app (`usePerms`, `src/lib/rights.ts`) only show or hide controls; every refusal is the server's (`server/internal/rbac`, `server/internal/httpapi`).",
  ],
  charts: [
    {
      caption: "From the first script to the first page drawn. The look is put in place before anything is drawn, so a returning visitor never sees the default colours flash; the server leaves out every draft the person may not see.",
      process: flow("code-frame-open", "Opening the portal", "What happens between loading the page and drawing the route.",
        [["browser", "Browser"], ["server", "Server"]],
        [
          s("script", "Run main.tsx and App.tsx", "browser", "automation", ["look"], "fonts, stylesheets"),
          s("look", "Put the last look in place", "browser", "automation", ["me"], "startLook, pm:look"),
          s("me", "Ask who is signed in", "browser", "communication", ["signed"], "GET /api/me"),
          s("signed", "Signed in?", "browser", "decision", [["login", "No"], ["fetch", "Yes"]]),
          s("login", "Show the sign-in page", "browser", "task", [], "Login.tsx"),
          s("fetch", "Load content, lists and feedback", "browser", "communication", ["answer"], "four GETs at once"),
          s("answer", "Leave out drafts the person may not see", "server", "verify", ["draw"], "canSee"),
          s("draw", "Draw the page of the address", "browser", "automation", [], "parseRoute, lazy page"),
        ]),
    },
    {
      caption: "How the route guard (`useRoute`, `mayLeave`) treats a move that would lose unsaved changes. Where the editing screen offers its own Save draft, that is the main answer; a refused save keeps the person where they are.",
      process: flow("code-frame-leave", "Leaving unsaved changes", "A move away from a place where something is being edited.",
        [["person", "Person"], ["browser", "Browser"]],
        [
          s("move", "Follow a link or press Back", "person", "task", ["lost"]),
          s("lost", "Would changes be lost?", "browser", "decision", [["show", "No"], ["hold", "Yes"]], "unsavedWork"),
          s("hold", "Hold the move, keep the history", "browser", "automation", ["ask"], "click stopped, or history.go"),
          s("ask", "Ask before leaving", "browser", "communication", ["answer"], "mayLeave"),
          s("answer", "What does the person choose?", "person", "decision", [["save", "Save draft and leave"], ["show", "Leave"], ["stay", "Stay"]]),
          s("save", "Save the draft first", "browser", "verify", [["show", "Saved"], ["stay", "Refused"]], "unsavedSaver"),
          s("stay", "Stay where the changes are", "browser", "task", []),
          s("show", "Show the new route", "browser", "automation", [], "setRoute"),
        ]),
    },
    {
      caption: "One call through `request()` in `src/lib/store.ts`, and what each kind of answer becomes in the app. Every page decides for itself what to show for a conflict.",
      process: flow("code-frame-call", "One call to the server", "The single path every call of the app takes.",
        [["browser", "Browser"], ["server", "Server"]],
        [
          s("call", "Send the request", "browser", "communication", ["reached"], "JSON, X-Requested-With"),
          s("reached", "Server reached?", "browser", "decision", [["fail", "No"], ["answer", "Yes"]]),
          s("answer", "Check the session, header and rights", "server", "verify", ["status"]),
          s("status", "What is the answer?", "browser", "decision", [["ok", "2xx"], ["out", "401"], ["conflict", "409"], ["fail", "Other"]]),
          s("ok", "Return the data", "browser", "automation", [], "204: nothing"),
          s("out", "Ask to sign in again on top", "browser", "communication", [], "pm:signed-out"),
          s("conflict", "Carry who saved first", "browser", "automation", [], "ApiError.conflict"),
          s("fail", "Throw the sentence to show", "browser", "automation", [], "ApiError"),
        ]),
    },
  ],
  examples: [
    {
      title: "An address and the route it stands for",
      caption: "The open step of a process is part of the address, so a link can point at it; the same route gives the address back and names the browser tab.",
      stages: [
        { label: "The address", shape: "#/p/request-gcp-project/flow/raise-request", note: "Typed, followed from a link, or written by `go()`." },
        { label: "Read by parseRoute", where: "src/lib/store.ts", shape: "{ \"page\": \"process\", \"id\": \"request-gcp-project\", \"tab\": \"flow\", \"item\": \"raise-request\" }", note: "An address it does not know is { \"page\": \"home\" }; the old #/p/request-gcp-project/json is { \"page\": \"edit-process\", \"id\": \"request-gcp-project\" }." },
        { label: "Drawn by Shell", where: "src/App.tsx", shape: "<ProcessPage key=\"request-gcp-project\" process={…} tab=\"flow\" item=\"raise-request\" … />", note: "The step's side panel is open because `item` is set." },
        { label: "Named by pageTitle", where: "src/lib/store.ts", shape: "Request a GCP project · Process Manager", note: "The portal's name (Admin › Theming) comes last." },
        { label: "Written back by href", where: "src/lib/store.ts", shape: "#/p/request-gcp-project/flow/raise-request", note: "The same address: `parseRoute` and `href` are each other's inverse (tested in `routes.test.ts`)." },
      ],
    },
  ],
  start: "src/App.tsx",
  files: [
    {
      path: "src/App.tsx",
      role: "The app's root: the sign-in gate, the shell with the top bar, the content loaded once for every page, the saves of whole documents, and the switch from the route to the page.",
      requirements: [
        { text: "`startLook()` runs when the module loads, before `createRoot` renders: moving it into a component would draw one frame in the default colours.", at: "startLook();" },
        { text: "Admin appears among the places only for `canOpenAdmin`; hiding it is a courtesy, `/api/admin/…` is refused by the server for everybody else.", at: "...(canOpenAdmin(perms) ? [{ key: \"admin\"" },
        { text: "A refresh that overlaps one of this tab's own saves is thrown away; without it the old version would come back on screen and the next save would be refused as made from an outdated version.", at: "if (writes.current !== started) return { p, s, c };" },
        { text: "Coming back to the tab refetches only after 20 seconds and only while visible, so switching windows quickly does not flood the server.", at: "if (document.visibilityState !== \"visible\" || Date.now() - loadedAt.current < REFRESH_AFTER_MS) return;" },
        { text: "The error boundary is keyed on the address: a crash on one page is cleared by going anywhere else, and the top bar outside it stays usable.", at: "<ErrorBoundary resetKey={href(route)}>" },
        { text: "The editing screen takes over the top bar only for whoever may draft the document (`canDraft`); anybody else gets the ordinary page saying they may not change it.", at: "const editing = (route.page === \"edit-process\" && !!process && canDraft(perms, \"process\", process))" },
      ],
      tests: ["src/lib/__tests__/routes.test.ts", "e2e/frame.spec.ts", "e2e/layout.spec.ts", "e2e/auth.spec.ts"],
    },
    {
      path: "src/lib/store.ts",
      role: "Every call to the server, the routes with their parsing and writing, the guard for unsaved changes, and small browser helpers (copy, download, the checklist ticks).",
      requirements: [
        { text: "Every change carries the headers of `changeHeaders`: `X-Requested-With`, without which the server's CSRF guard refuses it, and `X-Acting-As`, the address `/api/me` gave this page, so that a page left open while viewing as somebody else started or stopped in another tab is refused (409) instead of acting as the other person. A call made around `request()` (a plain `fetch`) would lack both; `uploadIcon`, the one other `fetch` that changes something, uses `changeHeaders` too.", at: "headers: method === \"GET\" ? undefined : changeHeaders()," },
        { text: "`/api/me` is excluded so that the sign-in page can ask who is signed in without opening the \"You are signed out\" dialog.", at: "if (res.status === 401 && path !== \"/api/me\") {" },
        { text: "Only a 409 that carries `conflict` becomes a conflict; the editing screen and Theming read `conflict.updatedBy` to say who saved first.", at: "if (res.status === 409 && data?.conflict) err.conflict = data.conflict as Conflict;" },
        { text: "Every save names `base` (the version the changes were made from), which is how the server refuses a save from an outdated version; `draft` is added only when replacing a never-published document's working draft.", at: "const saveQuery = (base: number, note = \"\", draft?: number) =>" },
        { text: "An unknown key in a search address is skipped and allowed values are checked, so an edited link cannot put an unknown filter or a page size of 1000 into the state.", at: "if (!(SEARCH_LISTS as readonly string[]).includes(key)) continue;" },
        { text: "Page 1 is never written, so the same list has one address.", at: "if (r.pageNo && Number.isInteger(r.pageNo) && r.pageNo > 1) parts.push(`page=${r.pageNo}`);" },
        { text: "Unsaved changes live only on the editing screens (the document and its JSON text), Admin › Lists (`catalog`) and Admin › Theming (`theme`); a new place that edits must be added here or its changes are lost without a question.", at: "const placesOf = (r: Route): string[] => {" },
        { text: "\"Save draft and leave\" is offered only when every place that would lose changes can save them; text with problems in the JSON cannot, and then only Leave or Stay are offered.", at: "if (!lost.length || !lost.every((k) => savers.has(k))) return null;" },
        { text: "Where the browser cannot tell the direction of a Back or Forward, the address is put back in place instead of guessing, so the history is never moved the wrong way.", at: "if (back === 0) {" },
      ],
      tests: ["src/lib/__tests__/routes.test.ts", "src/lib/__tests__/search.test.ts", "src/lib/__tests__/searchScreens.test.ts", "e2e/paging.spec.ts", "e2e/auth.spec.ts", "e2e/savemodel.spec.ts"],
    },
    {
      path: "src/main.tsx",
      role: "The entry point: imports the fonts and the two global stylesheets and mounts `App`.",
      requirements: [
        { text: "Both fonts come from the app's own bundle (`@fontsource-variable/*`); Roboto is the default; importing Inter only declares it, its files are fetched when a look chooses it. Nothing is loaded from another host.", at: "import \"@fontsource-variable/roboto\";" },
      ],
    },
    {
      path: "src/lib/session.tsx",
      role: "The signed-in person and their rights as React context, and the feedback actions shared by every page.",
      requirements: [
        { text: "Without rights from `/api/me` the app assumes none (`NO_PERMS`), so a missing field hides controls rather than showing them; the server decides either way.", at: "export const usePerms = (): Perms => useContext(MeContext).perms ?? NO_PERMS;" },
      ],
    },
    {
      path: "src/lib/media.ts",
      role: "Media queries read in code, printing, the printed last line, and re-measuring text once fonts arrive.",
      requirements: [
        { text: "The print version is drawn with `flushSync` inside `beforeprint`; an ordinary state update would come after the browser laid out the paper, and the screen version would be printed.", at: "const on = () => flushSync(() => setPrinting(true));" },
        { text: "Only a phone arriving at the map without a step is moved to the checklist; a link to a step on the map keeps the map.", at: "return phone && tab === \"flow\" && !item ? \"list\" : null;" },
      ],
      tests: ["src/lib/__tests__/readerPages.test.ts", "src/lib/__tests__/fonts.test.ts"],
    },
    {
      path: "src/print.css",
      role: "Printing: a process or standard prints as a document on light paper; every other page prints without the top bar and its controls.",
      requirements: [
        { text: "Somebody with a dark screen still prints dark text on white: the light tokens are set again with a selector that outweighs `[data-theme=\"dark\"]`, and they read `--theme-light-…`, so a chosen brand and kind colours stay.", at: "html:root, html:root[data-theme=\"dark\"] {" },
      ],
    },
    {
      path: "src/lib/dates.ts",
      role: "The one way dates and times are written in the app, and the one place that knows the reader's day: `today`, `dayOf`, `daysBetween`, `addDays`, `addMonths`, `isDay`.",
      requirements: [
        { text: "A plain date is returned untouched: `new Date(\"2026-11-13\")` is UTC midnight and would be shown as the day before west of UTC.", at: "if (value && DAY_ONLY.test(value)) return value;" },
        { text: "Today and the day of a moment are the reader's, in the browser's zone unless a zone is named (for tests and the UTC-day scripts); no other code builds a day by hand, which `dates.test.ts` checks over `src/` and `scripts/`.", at: "export function today(now: Date = new Date(), zone?: string): string {" },
        { text: "The arithmetic on days is on calendar days, the same in every zone; months run on past a shorter month as the server's `AddDate` does.", at: "export function addMonths(day: string, n: number): string {" },
      ],
      tests: ["src/lib/__tests__/dates.test.ts"],
    },
    {
      path: "src/lib/selection.ts",
      role: "The step or requirement that is open, kept in the address without tearing the side panel down while the address catches up.",
      requirements: [
        { text: "Closing goes Back only when that leads to this very page without the item; otherwise the address is replaced, so Back never opens again what was closed.", at: "if (from !== null && from === href(address(null))) history.back(); else go(address(null), { replace: true });" },
      ],
    },
    {
      path: "src/lib/profile.ts",
      role: "\"My application\" (tier, environment, language), kept in this browser, and values remembered for the open tab.",
      requirements: [
        { text: "My application is a fact about the reader, kept in localStorage and shared by every list and standard page through the `pm:profile-changed` event; a link never carries it.", at: "localStorage.setItem(KEY, JSON.stringify(p))" },
        { text: "`useRemembered` keeps a value for the tab only (sessionStorage): a new tab starts without \"Only my bookmarks\".", at: "try { const raw = sessionStorage.getItem(key);" },
      ],
    },
    {
      path: "src/lib/catalog.tsx",
      role: "The lists (teams, platforms, practices, categories, tools, tiers, environments, languages) as React context, with their names.",
      requirements: [
        { text: "A list missing from an older file or server becomes empty, never `undefined`, so pages can map over every list without checks.", at: "export const completeCatalog = (" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts", "src/lib/__tests__/groups.test.ts"],
    },
    {
      path: "src/types.ts",
      role: "The TypeScript types of the app: processes, standards, the lists, feedback, rights and what the server says about each document.",
      requirements: [
        { text: "These types mirror `schema/*.schema.json`; a format changes in the schema first (`npm run validators`), and a value allowed only here is refused by the server's schema check when it is saved." },
        { text: "`DocMeta.draft` (unpublished changes) is filled by the server only for people with `CanDraft` on that document, in `listDocs` (`server/internal/httpapi/content.go`); here it is only typed, and pages only show it." },
      ],
    },
    {
      path: "src/components/ui.tsx",
      role: "Shared parts of the frame: layers (focus, Escape, Tab), dialogs, notices, loading and load errors, the error boundary, fields.",
      requirements: [
        { text: "Only the topmost layer reacts to keys: one Escape closes a dialog, not the side panel under it as well.", at: "if (layers[layers.length - 1] !== token) return;" },
        { text: "Focus goes back to the opener only when it was inside the closed layer, so it is never taken from where the person went meanwhile.", at: "if (active && active !== document.body && !(node && node.contains(active))) return;" },
        { text: "The crash screen clears when `resetKey` (the address) changes; without it every other page would stay on the crash screen.", at: "if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });" },
      ],
      tests: ["src/lib/__tests__/adminFrame.test.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/components/Login.tsx",
      role: "The sign-in page: a list of made-up people for local development, else one button to the identity provider.",
      requirements: [
        { text: "The people to pick from come only from `/api/me` (`devUsers`), which lists them only while dev sign-in is on; a real installation shows the provider's button.", at: "{me.provider === \"dev\" ? (" },
      ],
      tests: ["e2e/auth.spec.ts"],
    },
    {
      path: "src/components/PersonLink.tsx",
      role: "A person in a sentence: by name where known (`personLabel`), the address as tooltip and mail link.",
      requirements: [
        { text: "The visible words come from `personLabel` only; a page that writes `email` itself would name people differently from everywhere else.", at: "export function PersonLink({ person, children }" },
      ],
    },
  ],
};
