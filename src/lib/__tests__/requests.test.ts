import { describe, expect, it } from "vitest";
import {
  filterRequests, parseRequestsQuery, requestProblems, requestsQuery, similarTitles, sortRequests, stateCounts, titleWords, toggledVote, type DocRequest,
} from "../requests";
import { href, pageTitle, parseRoute } from "../store";

const req = (id: number, p: Partial<DocRequest> = {}): DocRequest => ({
  id, kind: "process", title: `Request ${id}`, description: "Something is needed here", platform: "", practice: "",
  requestedBy: { name: "Sam", email: "sam@example.com" }, createdAt: `2026-11-0${id}T10:00:00Z`,
  state: "open", stateNote: "", stateBy: "", stateAt: "", linkedId: "", votes: 0, votedByMe: false, mine: false, canManage: false, ...p,
});

describe("the list of requests", () => {
  it("puts the most wanted first, then the newest", () => {
    const list = [req(1, { votes: 2 }), req(2, { votes: 5 }), req(3, { votes: 2 }), req(4)];
    expect(sortRequests(list).map((r) => r.id)).toEqual([2, 3, 1, 4]);
  });
  it("filters by state and kind, and counts what each filter would show", () => {
    const list = [req(1), req(2, { state: "done" }), req(3, { kind: "standard" }), req(4, { kind: "standard", state: "declined" })];
    expect(filterRequests(list, "open").map((r) => r.id)).toEqual([3, 1]);
    expect(filterRequests(list, "open", "standard").map((r) => r.id)).toEqual([3]);
    expect(filterRequests(list, "all", "standard").map((r) => r.id)).toEqual([4, 3]);
    expect(stateCounts(list)).toEqual({ open: 2, planned: 0, done: 1, declined: 1, all: 4 });
    expect(stateCounts(list, "process")).toEqual({ open: 1, planned: 0, done: 1, declined: 0, all: 2 });
  });
  it("shows a vote at once, and the reverse puts it back", () => {
    const r = req(1, { votes: 3 });
    const on = toggledVote(r);
    expect(on).toMatchObject({ votes: 4, votedByMe: true });
    expect(toggledVote(on)).toMatchObject({ votes: 3, votedByMe: false });
    expect(toggledVote(req(2, { votes: 0, votedByMe: true })).votes).toBe(0);
  });
});

describe("a new request", () => {
  it("needs a name and a reason of the right length", () => {
    expect(requestProblems({ title: "Kafka", description: "We need topics for events" })).toEqual({});
    expect(requestProblems({ title: " ab ", description: "short" })).toEqual({ title: expect.any(String), description: expect.any(String) });
    expect(requestProblems({ title: "x".repeat(121), description: "y".repeat(1001) })).toEqual({ title: expect.stringMatching(/at most 120/), description: expect.stringMatching(/1000/) });
  });
});

describe("similar titles", () => {
  const docs = [
    { id: "a", title: "Request a GCP project" }, { id: "b", title: "Request a database" },
    { id: "c", title: "Secure logging" }, { id: "d", title: "Onboard to Akamai" },
  ];
  it("ignores small words and plurals", () => {
    expect(titleWords("How to request the new GCP projects")).toEqual(["request", "gcp", "project"]);
    expect(titleWords("Access")).toEqual(["access"]);
  });
  it("needs two shared words, or the only one", () => {
    expect(similarTitles("Request GCP projects", docs).map((s) => s.item.id)).toEqual(["a"]);
    // "request" alone is shared by many: not enough
    expect(similarTitles("Request a Kafka topic", docs)).toEqual([]);
    expect(similarTitles("Akamai", docs).map((s) => s.item.id)).toEqual(["d"]);
    expect(similarTitles("Logging standard for secure apps", docs).map((s) => s.item.id)).toEqual(["c"]);
    expect(similarTitles("the a", docs)).toEqual([]);
  });
  it("puts the best match first and keeps to the limit", () => {
    const many = [{ title: "GCP project" }, { title: "Request a GCP project now" }, { title: "GCP project costs" }];
    expect(similarTitles("Request a GCP project", many, 2).map((s) => s.item.title)).toEqual(["Request a GCP project now", "GCP project"]);
  });
});

describe("the address of the requests", () => {
  it("keeps the state and kind filters", () => {
    expect(parseRoute("#/requests")).toEqual({ page: "requests" });
    expect(parseRoute("#/requests?state=done")).toEqual({ page: "requests", state: "done" });
    expect(parseRoute("#/requests?state=all&kind=standard")).toEqual({ page: "requests", state: "all", kind: "standard" });
    expect(parseRoute("#/requests?state=nonsense&kind=x")).toEqual({ page: "requests" });
    for (const r of [{ page: "requests" as const }, { page: "requests" as const, state: "open" as const }, { page: "requests" as const, state: "declined" as const, kind: "process" as const }]) {
      expect(parseRoute(href(r))).toEqual(r);
    }
    expect(href({ page: "requests", state: "planned", kind: "process" })).toBe("#/requests?state=planned&kind=process");
    expect(parseRequestsQuery("kind=process")).toEqual({ kind: "process" });
    expect(requestsQuery({})).toBe("");
    expect(pageTitle({ page: "requests" })).toBe("Requests · Process Manager");
  });
  it("and of Admin > Statistics", () => {
    expect(parseRoute("#/admin/statistics")).toEqual({ page: "admin", section: "statistics" });
    expect(href({ page: "admin", section: "statistics" })).toBe("#/admin/statistics");
    expect(pageTitle({ page: "admin", section: "statistics" })).toBe("Statistics · Admin · Process Manager");
  });
});
