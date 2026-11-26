import { describe, expect, it } from "vitest";
import type { Catalog } from "../../types";
import { completeCatalog, EMPTY_CATALOG } from "../catalog";
import { domainOf, NO_TRIBE, partOf, partOfText, teamChoices, teamSections, teamsOfTribe, tidyLists, tribeOf, tribesOfDomain } from "../groups";
import { hasErrors, LIST_WORDS, refusalIssues, unknownGroupSentence, validateCatalog } from "../validate";
import { issueText, listIssueField, listIssuePlace, refusalText } from "../editing";
import { CATALOG_LISTS, parseRoute } from "../store";
import { catalog as sample, readJson } from "./fixtures";

// Tribes group teams and domains group tribes: two optional lists. A team may name a tribe, a
// tribe a domain; none of it is ever a problem when left out.

const lists = (extra: Partial<Catalog> = {}): Catalog => completeCatalog({
  ...EMPTY_CATALOG,
  teams: [
    { id: "pay", name: "Payments team", tribe: "money" },
    { id: "check", name: "Checkout team", tribe: "money" },
    { id: "net", name: "Network team", tribe: "infra" },
    { id: "sec", name: "Security", tribe: "trust" },
    { id: "ful", name: "Fulfilment team" },
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

describe("the tribes and domains of the sample", () => {
  it("group most teams: two domains, four tribes, a team in no tribe and a tribe in no domain", () => {
    expect(sample.domains?.map((d) => d.name)).toEqual(["Engineering enablement", "Platforms and infrastructure"]);
    expect(sample.tribes?.map((t) => `${t.name}:${t.domain ?? "-"}`)).toEqual(["Cloud:platforms-infrastructure", "Connectivity:platforms-infrastructure", "Developer tools:engineering-enablement", "Trust and service:-"]);
    expect(sample.teams.filter((t) => !t.tribe).map((t) => t.id)).toEqual(["fulfilment-team"]);
    expect(validateCatalog(sample)).toEqual([]);
    // the demo set holds every sample team as it is, with tribes of its own on top
    const demo = readJson<Catalog>("demo/catalog/catalog.json");
    for (const t of sample.teams) expect(demo.teams).toContainEqual(t);
    expect(demo.domains).toEqual(sample.domains);
    expect(demo.teams.filter((t) => !t.tribe).length).toBeGreaterThan(0);
    expect(validateCatalog(demo)).toEqual([]);
  });
});

describe("the lists", () => {
  it("are complete with empty tribes and domains when stored without them", () => {
    expect(completeCatalog({ teams: [] } as Partial<Catalog>).tribes).toEqual([]);
    expect(completeCatalog({ teams: [] } as Partial<Catalog>).domains).toEqual([]);
    expect(tidyLists({ ...lists(), tribes: [{ id: "x", name: "X", description: " ", domain: "" }] }).tribes).toEqual([{ id: "x", name: "X" }]);
    expect(tidyLists({ ...lists(), teams: [{ id: "a", name: "A", tribe: "" }] }).teams).toEqual([{ id: "a", name: "A" }]);
    expect(CATALOG_LISTS).toContain("tribes");
    expect(parseRoute("#/catalog/tribes/money")).toEqual({ page: "catalog", list: "tribes", id: "money" });
  });
  it("are fine with everything left out: a tribe without teams or a domain, a domain without tribes", () => {
    expect(validateCatalog(lists())).toEqual([]);
    const { tribes: _t, domains: _d, ...without } = lists({ teams: [{ id: "a", name: "A" }] });
    void _t; void _d;
    expect(validateCatalog(without)).toEqual([]);
  });
  it("refuse a tribe or a domain that is not in its list, by name, and lead to the field", () => {
    const c = lists({ teams: [{ id: "a", name: "Payments team", tribe: "gone" }], tribes: [{ id: "t", name: " ", domain: "nowhere" }] });
    const issues = validateCatalog(c);
    expect(issues).toEqual([
      { level: "error", path: "teams[0].tribe", message: "The team “Payments team” is part of the tribe “gone”, which is not in the list of tribes: choose another tribe, or none." },
      { level: "error", path: "tribes[0].domain", message: "The tribe with the id “t” is part of the domain “nowhere”, which is not in the list of domains: choose another domain, or none." },
    ]);
    expect(issues.map((i) => issueText(i, "lists", c))).toEqual(issues.map((i) => i.message));
    expect(listIssuePlace("teams[0].tribe")).toEqual({ list: "teams", index: 0, field: "tribe" });
    expect(listIssueField("tribes[2].domain")).toEqual(['[data-field="domain"]']);
    expect(unknownGroupSentence("tribe", { id: "x", name: "Money" }, "y")).toBe("The tribe “Money” is part of the domain “y”, which is not in the list of domains: choose another domain, or none.");
    // the server says the same: worded as it is
    const error = "teams[0].tribe: The team “Payments team” is part of the tribe “gone”, which is not in the list of tribes: choose another tribe, or none.";
    expect(refusalIssues(error)!.issues[0].path).toBe("teams[0].tribe");
    expect(refusalText(error, "lists", c)).toBe("The team “Payments team” is part of the tribe “gone”, which is not in the list of tribes: choose another tribe, or none.");
  });
  it("check the ids of tribes and domains like the other lists", () => {
    expect(LIST_WORDS.tribes).toEqual({ one: "tribe", many: "tribes" });
    expect(LIST_WORDS.domains).toEqual({ one: "domain", many: "domains" });
    const twice = validateCatalog(lists({ domains: [{ id: "d", name: "D" }, { id: "d", name: "E" }] }));
    expect(twice.map((i) => i.message)).toContain("Two domains have the id “d” (“D” and “E”): remove one of them.");
    expect(hasErrors(validateCatalog(lists({ tribes: [{ id: "t", name: "T", domain: "Not A Slug" }] })))).toBe(true);
  });
});

describe("where a team belongs", () => {
  const c = lists();
  it("is its tribe and that tribe's domain", () => {
    expect(tribeOf(c, c.teams[0])?.name).toBe("Money");
    expect(domainOf(c, tribeOf(c, c.teams[0]))?.name).toBe("Digital");
    expect(tribeOf(c, { tribe: "gone" })).toBeUndefined();
    expect(teamsOfTribe(c, "money").map((t) => t.name)).toEqual(["Checkout team", "Payments team"]);
    expect(tribesOfDomain(c, "digital").map((t) => t.name)).toEqual(["Empty tribe", "Money"]);
    expect(tribesOfDomain(c, "spare")).toEqual([]);
  });
  it("is said in one sentence, the names as pieces of their own", () => {
    expect(partOfText(c, c.teams[0])).toBe("Part of the tribe Money, in the domain Digital");
    expect(partOf(c, c.teams[0]).filter((p) => p.list)).toEqual([{ text: "Money", list: "tribes", id: "money" }, { text: "Digital", list: "domains", id: "digital" }]);
    expect(partOfText(c, c.teams[3])).toBe("Part of the tribe Trust");
    expect(partOf(c, c.teams[4])).toEqual([]);
    expect(partOf(c, { tribe: "gone" })).toEqual([]);
  });
});

describe("Teams & tools groups the teams", () => {
  it("under their domain and tribe, by name; tribes in no domain next; teams in no tribe last; empty ones left out", () => {
    const c = lists();
    const out = teamSections(c, c.teams).map((s) => ({
      domain: s.domain === null ? null : s.domain?.name ?? "(none)",
      tribes: s.tribes.map((t) => `${t.tribe?.name ?? NO_TRIBE}: ${t.teams.map((x) => x.name).join(", ")}`),
    }));
    expect(out).toEqual([
      { domain: "Digital", tribes: ["Money: Payments team, Checkout team"] },
      { domain: "Platform", tribes: ["Infrastructure: Network team"] },
      { domain: "(none)", tribes: ["Trust: Security"] },
      { domain: null, tribes: ["Not in a tribe: Fulfilment team"] },
    ]);
  });
  it("only as far as the teams shown go (a search), and not at all without tribes", () => {
    const c = lists();
    expect(teamSections(c, [c.teams[2]]).map((s) => s.domain?.name)).toEqual(["Platform"]);
    expect(teamSections(lists({ tribes: [], domains: [] }), c.teams)).toEqual([{ domain: null, tribes: [{ teams: c.teams }] }]);
  });
  it("and so does the choice of a team, by tribe with its domain, when there are tribes", () => {
    expect(teamChoices(lists()).map((g) => `${g.label}: ${g.teams.map((t) => t.id).join(",")}`)).toEqual([
      "Money (Digital): check,pay", "Infrastructure (Platform): net", "Trust: sec", "Not in a tribe: ful",
    ]);
    const flat = lists({ tribes: [] });
    expect(teamChoices(flat)).toEqual([{ teams: flat.teams }]);
  });
});
