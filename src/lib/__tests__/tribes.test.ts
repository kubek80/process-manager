import { describe, expect, it } from "vitest";
import type { Catalog } from "../../types";
import { completeCatalog, EMPTY_CATALOG } from "../catalog";
import {
  clusterContents, clusterEmpty, clusterEntry, clusterFilter, domainOf, NO_PILLAR, partOf, partOfText, pillarOf, pillarsOfTribe, placeOf,
  teamChoices, teamSections, teamsOfPillar, tidyLists, tribeOf, tribesOfDomain,
} from "../groups";
import { hasErrors, LIST_WORDS, refusalIssues, unknownGroupSentence, validateCatalog } from "../validate";
import { issueText, listIssueField, listIssuePlace, refusalText } from "../editing";
import { CATALOG_LISTS, href, pageTitle, parseRoute } from "../store";
import { opensChange } from "../rights";
import { search } from "../search";
import { base, catalog as sample, readJson } from "./fixtures";

// Pillars group teams, tribes group pillars and domains group tribes: three optional lists. A team
// may name a pillar, a pillar a tribe, a tribe a domain; none of it is ever a problem when left out.

const lists = (extra: Partial<Catalog> = {}): Catalog => completeCatalog({
  ...EMPTY_CATALOG,
  teams: [
    { id: "pay", name: "Payments team", pillar: "cards" },
    { id: "check", name: "Checkout team", pillar: "cards" },
    { id: "ledger", name: "Ledger team", pillar: "books" },
    { id: "net", name: "Network team", pillar: "wires" },
    { id: "sec", name: "Security", pillar: "guard" },
    { id: "lab", name: "Lab team", pillar: "loose" },
    { id: "ful", name: "Fulfilment team" },
  ],
  pillars: [
    { id: "cards", name: "Cards", tribe: "money" },
    { id: "books", name: "Books", tribe: "money" },
    { id: "wires", name: "Wires", tribe: "infra" },
    { id: "guard", name: "Guard", tribe: "trust" },
    { id: "loose", name: "Loose pillar" },
    { id: "hollow", name: "Hollow", tribe: "money" },
  ],
  tribes: [
    { id: "money", name: "Money", domain: "digital" },
    { id: "infra", name: "Infrastructure", domain: "platform" },
    { id: "trust", name: "Trust" },
    { id: "empty", name: "Empty tribe", domain: "digital" },
  ],
  domains: [{ id: "platform", name: "Platform" }, { id: "digital", name: "Digital" }, { id: "spare", name: "Spare" }],
  ...extra,
});

describe("the pillars, tribes and domains of the sample", () => {
  it("group most teams: two domains, four tribes, six pillars; a team in no pillar and a pillar in no tribe", () => {
    expect(sample.domains?.map((d) => d.name)).toEqual(["Engineering enablement", "Platforms and infrastructure"]);
    expect(sample.tribes?.map((t) => `${t.name}:${t.domain ?? "-"}`)).toEqual(["Cloud:platforms-infrastructure", "Connectivity:platforms-infrastructure", "Developer tools:engineering-enablement", "Trust and service:-"]);
    expect(sample.pillars?.map((p) => `${p.name}:${p.tribe ?? "-"}`)).toEqual([
      "Cloud foundations:cloud-tribe", "Core network:connectivity-tribe", "Cyber defence:trust-service-tribe", "Edge and APIs:connectivity-tribe",
      "Engineering productivity:developer-tools-tribe", "Service operations:-",
    ]);
    expect(sample.teams.filter((t) => !t.pillar).map((t) => t.id)).toEqual(["fulfilment-team"]);
    expect(sample.teams.some((t) => "tribe" in t)).toBe(false);
    expect(validateCatalog(sample)).toEqual([]);
    // the demo set holds every sample team as it is, with pillars of its own on top
    const demo = readJson<Catalog>("demo/catalog/catalog.json");
    for (const t of sample.teams) expect(demo.teams).toContainEqual(t);
    for (const p of sample.pillars!) expect(demo.pillars).toContainEqual(p);
    expect(demo.domains).toEqual(sample.domains);
    expect(demo.teams.filter((t) => !t.pillar).length).toBeGreaterThan(0);
    expect(validateCatalog(demo)).toEqual([]);
  });
});

describe("the lists", () => {
  it("are complete with empty pillars, tribes and domains when stored without them", () => {
    const c = completeCatalog({ teams: [] } as Partial<Catalog>);
    expect([c.pillars, c.tribes, c.domains]).toEqual([[], [], []]);
    expect(tidyLists({ ...lists(), pillars: [{ id: "x", name: "X", description: " ", tribe: "" }] }).pillars).toEqual([{ id: "x", name: "X" }]);
    expect(tidyLists({ ...lists(), teams: [{ id: "a", name: "A", pillar: "" }] }).teams).toEqual([{ id: "a", name: "A" }]);
    expect(CATALOG_LISTS).toContain("pillars");
    expect(parseRoute("#/teams/pillars/cards")).toEqual({ page: "catalog", place: "teams", list: "pillars", id: "cards" });
  });
  it("are fine with everything left out: an empty pillar, a pillar in no tribe, a team in no pillar", () => {
    expect(validateCatalog(lists())).toEqual([]);
    const { pillars: _p, tribes: _t, domains: _d, ...without } = lists({ teams: [{ id: "a", name: "A" }] });
    void _p; void _t; void _d;
    expect(validateCatalog(without)).toEqual([]);
  });
  it("refuse a pillar, tribe or domain that is not in its list, by name, and lead to the field", () => {
    const c = lists({ teams: [{ id: "a", name: "Payments team", pillar: "gone" }], pillars: [{ id: "p", name: "Cards", tribe: "nowhere" }], tribes: [{ id: "t", name: " ", domain: "far" }] });
    const issues = validateCatalog(c);
    expect(issues).toEqual([
      { level: "error", path: "teams[0].pillar", message: "The team “Payments team” is part of the pillar “gone”, which is not in the list of pillars: choose another pillar, or none." },
      { level: "error", path: "pillars[0].tribe", message: "The pillar “Cards” is part of the tribe “nowhere”, which is not in the list of tribes: choose another tribe, or none." },
      { level: "error", path: "tribes[0].domain", message: "The tribe with the id “t” is part of the domain “far”, which is not in the list of domains: choose another domain, or none." },
    ]);
    expect(issues.map((i) => issueText(i, "lists", c))).toEqual(issues.map((i) => i.message));
    expect(listIssuePlace("teams[0].pillar")).toEqual({ list: "teams", index: 0, field: "pillar" });
    expect(listIssueField("teams[2].pillar")).toEqual(['[data-field="pillar"]']);
    expect(listIssueField("pillars[2].tribe")).toEqual(['[data-field="tribe"]']);
    expect(unknownGroupSentence("tribe", { id: "x", name: "Money" }, "y")).toBe("The tribe “Money” is part of the domain “y”, which is not in the list of domains: choose another domain, or none.");
    // a team straight in a tribe (the shape before pillars) no longer fits the format
    expect(hasErrors(validateCatalog(lists({ teams: [{ id: "a", name: "A", tribe: "money" } as never] })))).toBe(true);
    // the server says the same: worded as it is
    const error = "teams[0].pillar: The team “Payments team” is part of the pillar “gone”, which is not in the list of pillars: choose another pillar, or none.";
    expect(refusalIssues(error)!.issues[0].path).toBe("teams[0].pillar");
    expect(refusalText(error, "lists", c)).toBe("The team “Payments team” is part of the pillar “gone”, which is not in the list of pillars: choose another pillar, or none.");
  });
  it("check the ids of pillars, tribes and domains like the other lists", () => {
    expect(LIST_WORDS.pillars).toEqual({ one: "pillar", many: "pillars" });
    expect(LIST_WORDS.tribes).toEqual({ one: "tribe", many: "tribes" });
    const twice = validateCatalog(lists({ pillars: [{ id: "p", name: "P" }, { id: "p", name: "Q" }] }));
    expect(twice.map((i) => i.message)).toContain("Two pillars have the id “p” (“P” and “Q”): remove one of them.");
    expect(hasErrors(validateCatalog(lists({ pillars: [{ id: "p", name: "P", tribe: "Not A Slug" }] })))).toBe(true);
  });
});

describe("where a team belongs", () => {
  const c = lists();
  it("is its pillar, that pillar's tribe and that tribe's domain", () => {
    expect(pillarOf(c, c.teams[0])?.name).toBe("Cards");
    expect(tribeOf(c, pillarOf(c, c.teams[0]))?.name).toBe("Money");
    expect(domainOf(c, tribeOf(c, pillarOf(c, c.teams[0])))?.name).toBe("Digital");
    expect(pillarOf(c, { pillar: "gone" })).toBeUndefined();
    expect(teamsOfPillar(c, "cards").map((t) => t.name)).toEqual(["Checkout team", "Payments team"]);
    expect(pillarsOfTribe(c, "money").map((p) => p.name)).toEqual(["Books", "Cards", "Hollow"]);
    expect(tribesOfDomain(c, "digital").map((t) => t.name)).toEqual(["Empty tribe", "Money"]);
    expect(tribesOfDomain(c, "spare")).toEqual([]);
  });
  it("is said in one sentence, as far as the levels go, the names as pieces of their own", () => {
    expect(partOfText(c, c.teams[0])).toBe("Part of the pillar Cards, in the tribe Money, in the domain Digital");
    expect(partOf(c, c.teams[0]).filter((p) => p.list)).toEqual([
      { text: "Cards", list: "pillars", id: "cards" }, { text: "Money", list: "tribes", id: "money" }, { text: "Digital", list: "domains", id: "digital" },
    ]);
    expect(partOfText(c, c.teams[4])).toBe("Part of the pillar Guard, in the tribe Trust");
    expect(partOfText(c, c.teams[5])).toBe("Part of the pillar Loose pillar");
    expect(partOf(c, c.teams[6])).toEqual([]);
    expect(partOf(c, { pillar: "gone" })).toEqual([]);
    // the head of a pillar's and a tribe's page
    expect(placeOf(c, "pillar", c.pillars![0]).map((p) => p.text).join("")).toBe("Part of the tribe Money, in the domain Digital");
    expect(placeOf(c, "tribe", c.tribes![0]).map((p) => p.text).join("")).toBe("Part of the domain Digital");
    expect(placeOf(c, "pillar", c.pillars![4])).toEqual([]);
    expect(placeOf(c, "domain", {})).toEqual([]);
  });
});

describe("the reader's list groups the teams", () => {
  it("under their domain, then each pillar with its tribe; then what is in no domain, no tribe, no pillar", () => {
    const c = lists();
    const out = teamSections(c, c.teams).map((s) => ({
      heading: typeof s.heading === "string" ? s.heading : s.heading.name,
      groups: s.groups.map((g) => `${g.tribe?.name ?? "-"} › ${g.pillar?.name ?? NO_PILLAR}: ${g.teams.map((x) => x.name).join(", ")}`),
    }));
    expect(out).toEqual([
      { heading: "Digital", groups: ["Money › Books: Ledger team", "Money › Cards: Payments team, Checkout team"] },
      { heading: "Platform", groups: ["Infrastructure › Wires: Network team"] },
      { heading: "no-domain", groups: ["Trust › Guard: Security"] },
      { heading: "no-tribe", groups: ["- › Loose pillar: Lab team"] },
      { heading: "no-pillar", groups: ["- › Not in a pillar: Fulfilment team"] },
    ]);
  });
  it("only as far as the teams shown go (a search), and not at all without pillars", () => {
    const c = lists();
    expect(teamSections(c, [c.teams[3]]).map((s) => (typeof s.heading === "string" ? s.heading : s.heading.name))).toEqual(["Platform"]);
    expect(teamSections(lists({ pillars: [] }), c.teams)).toEqual([{ heading: "all", groups: [{ teams: c.teams }] }]);
  });
  it("and so does the choice of a team, by pillar with its tribe, when there are pillars", () => {
    expect(teamChoices(lists()).map((g) => `${g.label}: ${g.teams.map((t) => t.id).join(",")}`)).toEqual([
      "Books (Money): ledger", "Cards (Money): check,pay", "Wires (Infrastructure): net", "Guard (Trust): sec", "Loose pillar: lab", "Not in a pillar: ful",
    ]);
    const flat = lists({ pillars: [] });
    expect(teamChoices(flat)).toEqual([{ teams: flat.teams }]);
  });
});

describe("the page of a pillar, a tribe or a domain", () => {
  const c = lists();
  it("is at #/pillar/:id, #/tribe/:id and #/domain/:id, changes nothing, and names itself in the tab", () => {
    expect(parseRoute("#/pillar/cards")).toEqual({ page: "pillar", id: "cards" });
    expect(parseRoute("#/tribe/money")).toEqual({ page: "tribe", id: "money" });
    expect(parseRoute("#/domain/digital/")).toEqual({ page: "domain", id: "digital" });
    expect(href({ page: "pillar", id: "cards" })).toBe("#/pillar/cards");
    for (const h of ["#/pillar/cards", "#/tribe/money", "#/domain/digital"]) expect(opensChange(h)).toBe(false);
    expect(pageTitle({ page: "pillar", id: "cards" }, { group: "Cards" }, "Portal")).toBe("Cards · Portal");
    expect(pageTitle({ page: "pillar", id: "gone" }, {}, "Portal")).toBe("Pillar not found · Portal");
    expect(pageTitle({ page: "domain", id: "gone" }, {}, "Portal")).toBe("Domain not found · Portal");
    expect(parseRoute("#/admin/teams/pillars/cards")).toEqual({ page: "admin", section: "lists", place: "teams", list: "pillars", id: "cards" });
  });
  it("lists a pillar's teams; a tribe's pillars with their teams; a domain's tribes with their pillars", () => {
    expect(clusterEntry(c, "pillar", "cards")?.name).toBe("Cards");
    expect(clusterEntry(c, "tribe", "cards")).toBeUndefined();
    expect(clusterContents(c, "pillar", "cards").teams.map((t) => t.name)).toEqual(["Checkout team", "Payments team"]);
    const tribe = clusterContents(c, "tribe", "money");
    expect(tribe.pillars.map((p) => `${p.pillar.name}: ${p.teams.map((t) => t.id).join(",")}`)).toEqual(["Books: ledger", "Cards: check,pay", "Hollow: "]);
    expect(tribe.teams.map((t) => t.id)).toEqual(["ledger", "check", "pay"]);
    const domain = clusterContents(c, "domain", "digital");
    expect(domain.tribes.map((t) => `${t.tribe.name}: ${t.pillars.map((p) => p.pillar.name).join(",")}`)).toEqual(["Empty tribe: ", "Money: Books,Cards,Hollow"]);
    expect(domain.teams.map((t) => t.id)).toEqual(["ledger", "check", "pay"]);
    expect(clusterFilter(domain.teams)).toEqual({ owner: ["ledger", "check", "pay"] });
  });
  it("says so in plain words when there is nothing in it, and then nothing belongs to it", () => {
    expect(clusterEmpty("domain", clusterContents(c, "domain", "spare"))).toBe("No tribe is part of this domain yet.");
    expect(clusterEmpty("tribe", clusterContents(c, "tribe", "empty"))).toBe("No pillar is part of this tribe yet.");
    expect(clusterEmpty("pillar", clusterContents(c, "pillar", "hollow"))).toBe("No team is part of this pillar yet.");
    expect(clusterEmpty("tribe", clusterContents(lists({ teams: [] }), "tribe", "money"))).toBe("No team is part of the pillars of this tribe yet.");
    expect(clusterEmpty("domain", clusterContents(lists({ teams: [] }), "domain", "digital"))).toBe("No team is part of the tribes of this domain yet.");
    expect(clusterEmpty("tribe", clusterContents(c, "tribe", "money"))).toBe("");
    expect(clusterFilter([])).toBeNull();
  });
  it("shows what its teams own through the search every list uses: a draft only where drafts may be shown", () => {
    const own = (id: string, owner: string, status?: "draft") => ({ ...base(), id, title: id, owner, ...(status ? { status } : {}) });
    const processes = [own("a", "pay"), own("b", "ledger", "draft"), own("c", "net")];
    const filters = clusterFilter(clusterContents(c, "tribe", "money").teams)!;
    const ids = (drafts: boolean) => search({ processes, standards: [], catalog: c, filters, drafts }).results.map((r) => r.doc.id).sort();
    expect(ids(true)).toEqual(["a", "b"]);
    expect(ids(false)).toEqual(["a"]);
  });
});
