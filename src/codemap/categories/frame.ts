import type { CodeCategory } from "../types";
import { flow, s } from "../chart";

export const frame: CodeCategory = {
  id: "frame",
  area: "app",
  title: "The frame of the app",
  summary: "What holds the React app together: the start (main.tsx, App.tsx), the top bar and its places, the hash routing, and the one function every call to the server goes through (src/lib/store.ts). It also holds the signed-in person and their rights, the guard that asks before unsaved changes are lost, media queries and printing, and how dates are written. What a list shows (search, filters, order, page) lives in the address; only personal conveniences live in browser storage.",
  requirements: [
    "Every call to the server goes through request() in src/lib/store.ts: JSON in and out, and the header X-Requested-With: process-manager on every method but GET.",
    "A 401 on any path but /api/me sends the window event pm:signed-out; the app then shows SignedOutDialog on top of the page and keeps whatever is on screen, unsaved changes included.",
    "A 409 with a conflict in its body is thrown as an ApiError whose conflict says who saved first (the page that saved decides what to show); a server that cannot be reached is an ApiError with status 0 whose message says, for a change, that nothing was saved.",
    "Routing is the hash only: parseRoute reads it and href writes it, and an unknown address falls back to Home. Every page is drawn from the route; the reader's page and the editing screen are different routes (#/p/:id/… and #/p/:id/edit).",
    "Leaving a place with unsaved changes (a link, Back or Forward, a typed address, signing out, closing the tab) asks first; Back and Forward are undone while asking, so the history stays as it was whatever the answer.",
    "The places of the top bar are one list (places in App.tsx) used by the desktop bar and by the Menu that replaces it below 1120 pixels (styles.css hides .topbar > .nav at max-width 1119px).",
    "An answer of the server that was on its way while this tab saved something is dropped (the writes counter in Shell), so it never puts older content back on screen.",
    "The search, the filters of the panel (type, category, platform, practice, rigour, owner), a chosen order, the page and a chosen page size of the lists and the search results are in the address (ListState, SearchState). The yes/no filters \"Only my bookmarks\" and \"Only what needs a review\" are kept for the tab (sessionStorage), My application in this browser (localStorage).",
    "Browser storage holds only per-person conveniences, each read in try/catch: My application, the page size and the order a person chose last, cards or rows, the search mode, the checklist ticks, the last look and light or dark.",
    "Dates go through formatDate and formatDateTime (src/lib/dates.ts): a plain date is kept as it is, a moment is shown in the reader's own time as 2026-11-20 06:44.",
  ],
  charts: [
    {
      caption: "From the first script to the first page drawn. The look is put in place before anything is drawn, so a returning visitor never sees the default colours flash.",
      process: flow("code-frame-open", "Opening the portal", "What happens between loading the page and drawing the route.",
        [["browser", "Browser"], ["server", "Server"]],
        [
          s("script", "Run main.tsx and App.tsx", "browser", "code", ["look"], "fonts, stylesheets"),
          s("look", "Put the last look in place", "browser", "automation", ["me"], "startLook, pm:look"),
          s("me", "Ask who is signed in", "browser", "communication", ["answer-me"], "GET /api/me"),
          s("answer-me", "Answer with the person and rights", "server", "automation", ["signed"], "perms, provider"),
          s("signed", "Signed in?", "browser", "decision", [["login", "No"], ["fetch", "Yes"]]),
          s("login", "Show the sign-in page", "browser", "form", [], "Login.tsx"),
          s("fetch", "Load content, lists and feedback", "browser", "communication", ["answer"], "four GETs at once"),
          s("answer", "Send what this person may see", "server", "automation", ["route"], "drafts only to their editors"),
          s("route", "Read the address", "browser", "code", ["draw"], "parseRoute"),
          s("draw", "Draw the page of the route", "browser", "automation", [], "lazy pages, ErrorBoundary"),
        ]),
    },
    {
      caption: "How the route guard (useRoute and mayLeave) treats a move that would lose unsaved changes. Where the editing screen offers its own Save draft, that is the main answer.",
      process: flow("code-frame-leave", "Leaving unsaved changes", "A move away from a place where something is being edited.",
        [["person", "Person"], ["browser", "Browser"]],
        [
          s("move", "Follow a link or press Back", "person", "task", ["lost"]),
          s("lost", "Would changes be lost?", "browser", "decision", [["show", "No"], ["hold", "Yes"]], "unsavedWork"),
          s("hold", "Hold the move, keep the history", "browser", "code", ["ask"], "click stopped, or history.go back"),
          s("ask", "Ask before leaving", "browser", "form", ["answer"], "mayLeave"),
          s("answer", "What does the person choose?", "person", "decision", [["save", "Save draft and leave"], ["show", "Leave without saving"], ["stay", "Stay"]]),
          s("save", "Save with the screen's own Save draft", "browser", "code", ["saved"], "unsavedSaver"),
          s("saved", "Saved?", "browser", "decision", [["show", "Yes"], ["stay", "No"]]),
          s("stay", "Stay where the changes are", "browser", "verify", []),
          s("show", "Show the new route", "browser", "automation", [], "setRoute"),
        ]),
    },
    {
      caption: "One call to the server through request() in src/lib/store.ts, and what each kind of answer becomes in the app.",
      process: flow("code-frame-call", "One call to the server", "The single path every call of the app takes.",
        [["browser", "Browser"], ["server", "Server"]],
        [
          s("call", "Send the request", "browser", "code", ["reached"], "JSON, X-Requested-With"),
          s("reached", "Server reached?", "browser", "decision", [["unreachable", "No"], ["answer", "Yes"]]),
          s("unreachable", "Say that nothing was saved", "browser", "communication", [], "ApiError, status 0"),
          s("answer", "Check the session and rights", "server", "automation", ["status"]),
          s("status", "What is the answer?", "browser", "decision", [["ok", "2xx"], ["out", "401"], ["conflict", "409"], ["error", "Other"]]),
          s("ok", "Return the data", "browser", "automation", [], "204: nothing"),
          s("out", "Ask to sign in again on top", "browser", "form", [], "pm:signed-out"),
          s("conflict", "Carry who saved first", "browser", "code", [], "ApiError.conflict"),
          s("error", "Show the server's sentence", "browser", "communication", [], "data.error"),
        ]),
    },
  ],
  examples: [
    {
      title: "An address and the route it stands for",
      caption: "The open step of a process is part of the address, so a link can point at it; the same route gives the address back and names the browser tab.",
      stages: [
        { label: "The address", shape: "#/p/request-gcp-project/flow/raise-request", note: "Typed, followed from a link, or written by go()." },
        { label: "Read by parseRoute", where: "src/lib/store.ts", shape: "{ \"page\": \"process\", \"id\": \"request-gcp-project\", \"tab\": \"flow\", \"item\": \"raise-request\" }", note: "An address it does not know is { \"page\": \"home\" }; the old #/p/request-gcp-project/json is { \"page\": \"edit-process\", \"id\": \"request-gcp-project\" }." },
        { label: "Drawn by Shell", where: "src/App.tsx", shape: "<ProcessPage key=\"request-gcp-project\" process={…} tab=\"flow\" item=\"raise-request\" … />", note: "The step's side panel is open because item is set." },
        { label: "Named by pageTitle", where: "src/lib/store.ts", shape: "Request a GCP project · Process Manager", note: "The portal's name (Admin › Theming) comes last." },
        { label: "Written back by href", where: "src/lib/store.ts", shape: "#/p/request-gcp-project/flow/raise-request", note: "The same address: parseRoute and href are each other's inverse (tested in routes.test.ts)." },
      ],
    },
  ],
  start: "src/App.tsx",
  files: [
    {
      path: "src/App.tsx",
      role: "The app's root: the sign-in gate, the shell with the top bar, the content loaded once for every page, the saves of whole documents, and the switch from the route to the page.",
      requirements: [
        { text: "The last look is put in place when the module loads, before anything is drawn.", at: "startLook();" },
        { text: "Admin, the Guide, Home, search, group pages, requests and the editing screens are lazy: their code is fetched only when first opened.", at: "const AdminPage = lazy(" },
        { text: "The main places are one list, used by the desktop bar and by the Menu sheet; Admin is in it only for whoever may open Admin, My responsibilities only when there is something to show.", at: "const places: Place[] = [" },
        { text: "An answer that was on its way while this tab saved, created or deleted something is dropped: it describes the world before that save.", at: "if (writes.current !== started) return { p, s, c };" },
        { text: "Coming back to the tab after 20 seconds fetches the content again; a page with unsaved changes keeps them.", at: "const REFRESH_AFTER_MS = 20_000;" },
        { text: "A fault in one page is caught by the error boundary and cleared when the route changes; the top bar stays.", at: "<ErrorBoundary resetKey={href(route)}>" },
        { text: "A process, standard or group that is not in memory is asked for once more before \"not found\" is shown.", at: "function NotFound({ noun, recheck }" },
        { text: "The editing screen replaces the top bar only for somebody who may draft the document (canDraft); everybody else gets the ordinary page.", at: "const editing = (route.page === \"edit-process\"" },
      ],
      tests: ["src/lib/__tests__/routes.test.ts", "e2e/frame.spec.ts", "e2e/layout.spec.ts", "e2e/auth.spec.ts"],
    },
    {
      path: "src/main.tsx",
      role: "The entry point: imports the fonts and the two global stylesheets and mounts App.",
      requirements: [
        { text: "Both fonts ship with the app (@fontsource-variable): Inter is the default, Roboto's files are fetched only when a look chooses it; nothing comes from another host.", at: "import \"@fontsource-variable/roboto\";" },
        { text: "styles.css and print.css are imported here (theme.css by App.tsx); every other stylesheet is imported by the component that uses it.", at: "import \"./print.css\";" },
      ],
    },
    {
      path: "src/lib/store.ts",
      role: "Every call to the server, the routes with their parsing and writing, the guard for unsaved changes, and small browser helpers (copy, download, the checklist ticks).",
      requirements: [
        { text: "One function for every call: JSON body, X-Requested-With on every method but GET, readable errors.", at: "async function request<T>(method: string, path: string, body?: unknown)" },
        { text: "The CSRF header the server's request guard checks on every change.", at: "headers: method === \"GET\" ? undefined : { \"Content-Type\": \"application/json\", \"X-Requested-With\": \"process-manager\" }," },
        { text: "A lost session (401, except on /api/me) is announced to the window and never navigates away.", at: "if (res.status === 401 && path !== \"/api/me\") {" },
        { text: "A refused save (409) carries the server's conflict, so the page can say who saved first.", at: "if (res.status === 409 && data?.conflict) err.conflict = data.conflict as Conflict;" },
        { text: "A save names the version it was made from (base) and, for a never-published document, the revision of the working draft it replaces.", at: "const saveQuery = (base: number, note = \"\", draft?: number) =>" },
        { text: "Reading a search address: unknown keys, empty parts and values outside the allowed ones (type, rigour, size 12/24/48, mode, sort) are ignored; a broken escape such as a typed 100% is kept as typed.", at: "function parseSearch(query: string): Route {" },
        { text: "Writing a search address: page 1, a size that is not offered and the default mode (words) are left out.", at: "function searchHref(r: SearchState, path = \"#/search\"): string {" },
        { text: "Unsaved changes are kept by the editing screens (the document and its JSON text), Admin › Lists (catalog) and Admin › Theming (theme); a route that is not one of these places loses them.", at: "const placesOf = (r: Route): string[] => {" },
        { text: "Back, Forward and typed addresses have already moved when the app hears of them: the browser is sent back while asking and moved again on \"leave\".", at: "export function useRoute(ask?: LeaveQuestion): Route {" },
        { text: "The tab's title names what is read first and the portal's name last.", at: "export function pageTitle(" },
      ],
      tests: ["src/lib/__tests__/routes.test.ts", "src/lib/__tests__/search.test.ts", "src/lib/__tests__/searchScreens.test.ts", "src/lib/__tests__/meaning.test.ts", "e2e/paging.spec.ts", "e2e/auth.spec.ts"],
    },
    {
      path: "src/lib/session.tsx",
      role: "The signed-in person and their rights as React context, and the feedback actions shared by every page.",
      requirements: [
        { text: "Rights come from the server (/api/me); without them the app assumes none (NO_PERMS). The app only shows or hides controls with them.", at: "export const usePerms = (): Perms => useContext(MeContext).perms ?? NO_PERMS;" },
      ],
    },
    {
      path: "src/lib/media.ts",
      role: "Media queries read in code, printing, the printed last line, and re-measuring text once fonts arrive.",
      requirements: [
        { text: "One hook for every media query a page reads in code, following changes of the window.", at: "export function useMedia(query: string): boolean {" },
        { text: "While printing, a page draws its print version synchronously in beforeprint (flushSync), before the browser lays out the paper.", at: "export function usePrinting(): boolean {" },
        { text: "The last printed line says which document, which version, when its content changed and when and from where it was printed.", at: "export function printedLine(" },
        { text: "On a phone a process opens on its checklist unless the address names a step.", at: "export function arrivalTab(" },
      ],
      tests: ["src/lib/__tests__/readerPages.test.ts", "src/lib/__tests__/fonts.test.ts"],
    },
    {
      path: "src/print.css",
      role: "Printing: a process or standard prints as a document on light paper; every other page prints without the top bar and its controls.",
      requirements: [
        { text: "Paper is always light: the light tokens are set again inside @media print, also when the screen is dark; a chosen brand and kind colours stay.", at: "html:root, html:root[data-theme=\"dark\"] {" },
      ],
    },
    {
      path: "src/lib/dates.ts",
      role: "The one way dates and times are written in the app.",
      requirements: [
        { text: "A date without a time is kept as it is; a moment is the reader's own day; nothing or nonsense gives \"\".", at: "export function formatDate(value?: string | null): string {" },
        { text: "A moment as \"2026-11-20 06:44\" in the reader's own time, without seconds.", at: "export function formatDateTime(value?: string | null): string {" },
      ],
      tests: ["src/lib/__tests__/dates.test.ts"],
    },
    {
      path: "src/lib/selection.ts",
      role: "The step or requirement that is open, kept in the address without tearing the side panel down while the address catches up.",
      requirements: [
        { text: "Opening is a step forward in the history (Back closes it); moving to another item replaces the address; an address that points at an item that is not there is cleaned up.", at: "export function useSelectedItem(" },
      ],
    },
    {
      path: "src/lib/profile.ts",
      role: "\"My application\" (tier, environment, language), kept in this browser, and values remembered for the open tab.",
      requirements: [
        { text: "My application is a per-person convenience in localStorage, shared by every list and every standard page; it is not part of the address.", at: "const KEY = \"pm:profile\";" },
        { text: "Values remembered for the tab only (sessionStorage): \"Only my bookmarks\" and \"Only what needs a review\" on the lists.", at: "export function useRemembered<T>(" },
      ],
    },
    {
      path: "src/lib/catalog.tsx",
      role: "The lists (teams, platforms, practices, categories, tools, tiers, environments, languages) as React context, with their names.",
      requirements: [
        { text: "A list missing from an older file or server is empty, never undefined.", at: "export const completeCatalog = (" },
        { text: "The lists are saved on top of the version shown; a refused save carries the conflict.", at: "export const CatalogContext = createContext<CatalogApi>({" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts", "src/lib/__tests__/groups.test.ts"],
    },
    {
      path: "src/types.ts",
      role: "The TypeScript types of the app: processes, standards, the lists, feedback, rights and what the server says about each document.",
      requirements: [
        { text: "Mirrors schema/*.schema.json: a change of a format changes the schema first, then these types.", at: "export type StepType =" },
        { text: "DocMeta.draft (unpublished changes) is sent only to people who may work on the drafts of that document.", at: "export interface DocMeta {" },
      ],
    },
    {
      path: "src/components/ui.tsx",
      role: "Shared parts of the frame: layers (focus, Escape, Tab), dialogs, notices, loading and load errors, the error boundary, fields.",
      requirements: [
        { text: "Every layer moves focus in and back, Escape closes only the topmost, a modal layer keeps Tab inside.", at: "export function useLayer(" },
        { text: "A crash shows a page with Reload and Back to the start; a chunk that could not be fetched is told apart from other faults.", at: "export class ErrorBoundary" },
        { text: "Something that could not be loaded says so with Try again, never as an empty list.", at: "export function LoadError(" },
      ],
      tests: ["src/lib/__tests__/adminFrame.test.ts", "e2e/layout.spec.ts"],
    },
    {
      path: "src/components/Login.tsx",
      role: "The sign-in page: a list of made-up people for local development, else one button to the identity provider.",
      requirements: [
        { text: "Dev sign-in offers the people /api/me lists; OIDC providers sign in through /auth/login.", at: "{me.provider === \"dev\" ? (" },
      ],
      tests: ["e2e/auth.spec.ts"],
    },
    {
      path: "src/components/PersonLink.tsx",
      role: "A person in a sentence: by name where known (personLabel), the address as tooltip and mail link.",
      requirements: [
        { text: "People are named by personLabel, never by a second wording.", at: "export function PersonLink({ person, children }" },
      ],
    },
  ],
};
