import { describe, expect, it } from "vitest";
import type { Catalog, Process } from "../../types";
import { findServices, formWords, serviceTeams, serviceUses, servicesOfTeam } from "../services";
import { serviceStepIssue, validateCatalog, validateProcess } from "../validate";
import { correctedListsAddress, href, pageTitle, parseRoute } from "../store";
import { issueText } from "../editing";
import { catalog, processes } from "./fixtures";

const akamai = processes.find((p) => p.id === "onboard-site-to-akamai")!;

describe("the sample's services", () => {
  it("are six, each performed by a team of the lists, with a front-door form", () => {
    expect((catalog.services ?? []).map((s) => s.id)).toEqual(["api-portal-access", "cdn-configuration-change", "cloud-project-support", "dns-record-change", "firewall-rule-change", "penetration-test"]);
    for (const s of catalog.services ?? []) {
      expect(catalog.teams.some((t) => t.id === s.team)).toBe(true);
      expect(s.form).toMatch(/^https:\/\/forms\.example\.com\//);
    }
    expect(validateCatalog(catalog)).toEqual([]);
  });
  it("one is requested by a step of a sample process", () => {
    expect(akamai.steps.filter((s) => s.type === "service").map((s) => s.service)).toEqual(["dns-record-change"]);
  });
});

describe("the list of services", () => {
  it("finds by name, summary, team and the words of the description; every word must be found", () => {
    expect(findServices(catalog, "dns").map((s) => s.id)).toEqual(["dns-record-change"]);
    expect(findServices(catalog, "Cyber Security").map((s) => s.id)).toEqual(["cdn-configuration-change", "firewall-rule-change", "penetration-test"]); // its team, and two descriptions that name it
    expect(findServices(catalog, "dig +short").map((s) => s.id)).toEqual(["dns-record-change"]); // in its description only
    expect(findServices(catalog, "dns firewall")).toEqual([]);
    expect(findServices(catalog, "", "network-team").map((s) => s.id)).toEqual(["firewall-rule-change"]);
    expect(findServices(catalog, undefined).length).toBe(6);
  });
  it("offers the teams that perform services, with how many", () => {
    expect(serviceTeams(catalog).map((t) => `${t.name}:${t.count}`)).toEqual(["API Platform team:1", "Cloud Platform team:1", "Cyber Security:1", "DNS team:1", "Edge & CDN team:1", "Network team:1"]);
    expect(servicesOfTeam(catalog, "dns-team").map((s) => s.id)).toEqual(["dns-record-change"]);
    expect(servicesOfTeam(catalog, "fulfilment-team")).toEqual([]);
  });
  it("names the button by the service's own words, else “Request this service”", () => {
    expect(formWords({ formLabel: "Book a penetration test" })).toBe("Book a penetration test");
    expect(formWords({})).toBe("Request this service");
    expect(formWords({ formLabel: "  " })).toBe("Request this service");
  });
});

describe("where a service is used", () => {
  const draft: Process = { ...akamai, id: "a-draft", title: "A draft", status: "draft" };
  const retired: Process = { ...akamai, id: "old-one", title: "An old one", status: "deprecated" };
  it("is published processes with the steps that request it; never a draft; a retired one last, marked", () => {
    const uses = serviceUses([draft, retired, akamai], "dns-record-change");
    expect(uses.map((u) => `${u.process.id}${u.retired ? " (retired)" : ""}: ${u.steps.map((s) => `${s.number} ${s.id}`).join(", ")}`))
      .toEqual(["onboard-site-to-akamai: 9 switch-dns", "old-one (retired): 9 switch-dns"]);
    expect(serviceUses([akamai], "penetration-test")).toEqual([]);
  });
});

describe("a service step", () => {
  const step = (patch: Record<string, unknown>) => ({ ...akamai.steps.find((s) => s.id === "switch-dns")!, ...patch });
  it("requests a service of the list, and only a service step does", () => {
    expect(serviceStepIssue(step({}), catalog)).toBeNull();
    expect(serviceStepIssue(step({ service: undefined }), catalog)).toBe("A service step needs the service it requests: choose it under “Service”.");
    expect(serviceStepIssue(step({ type: "task" }), catalog)).toBe("Only a step of the kind Service requests a service: make it a Service step, or remove the service.");
    expect(serviceStepIssue(step({ service: "gone" }), catalog)).toBe("The service “gone” is not in the list of services: choose one of the list.");
  });
  it("is to fix on its field in the checker", () => {
    const p = { ...akamai, steps: akamai.steps.map((s) => (s.id === "switch-dns" ? { ...s, service: "gone" } : s)) };
    const issues = validateProcess(p, { catalog });
    expect(issues.filter((i) => i.path === "steps[8].service").map((i) => `${i.level}: ${i.message}`)).toEqual(["error: The service “gone” is not in the list of services: choose one of the list."]);
    expect(validateProcess(akamai, { catalog }).filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("the problems of a service in the lists", () => {
  const withService = (patch: Record<string, unknown>): Catalog => ({ ...catalog, services: [{ ...catalog.services![3], ...patch }] });
  it("say who and what to do, in the server's words", () => {
    const c = withService({ team: "gone-team" });
    expect(validateCatalog(c).map((i) => issueText(i, "lists", c))).toEqual(["The service “DNS record change” is performed by the team “gone-team”, which is not in the list of teams: choose another team."]);
    const noForm = withService({ form: undefined });
    expect(validateCatalog(noForm).map((i) => issueText(i, "lists", noForm))).toEqual(["Give the front-door form of the service “DNS record change”: the link where people request it."]);
    const badForm = withService({ form: "forms.example.com/x" });
    expect(validateCatalog(badForm).map((i) => issueText(i, "lists", badForm))).toEqual(["The front-door form of the service “DNS record change” is not a whole link: write it with https:// at the start."]);
    const noTeam = withService({ team: undefined });
    expect(validateCatalog(noTeam).map((i) => issueText(i, "lists", noTeam))).toEqual(["Choose the team that performs the service “DNS record change”."]);
  });
});

describe("the addresses of services", () => {
  it("are a place and a page for readers, and one entry of Admin", () => {
    expect(href({ page: "services" })).toBe("#/services");
    expect(href({ page: "services", q: "dns change", team: "dns-team" })).toBe("#/services?q=dns%20change&team=dns-team");
    expect(parseRoute("#/services?q=dns%20change&team=dns-team")).toEqual({ page: "services", q: "dns change", team: "dns-team" });
    expect(parseRoute("#/service/dns-record-change")).toEqual({ page: "service", id: "dns-record-change" });
    expect(href({ page: "admin", section: "lists", place: "services" })).toBe("#/admin/services");
    expect(href({ page: "admin", section: "lists", list: "services", id: "dns-record-change" })).toBe("#/admin/services/dns-record-change");
    expect(parseRoute("#/admin/services/dns-record-change")).toEqual({ page: "admin", section: "lists", place: "services", list: "services", id: "dns-record-change" });
    // under Services the part after the place is always an entry, whatever it is called
    expect(parseRoute("#/admin/services/teams")).toEqual({ page: "admin", section: "lists", place: "services", list: "services", id: "teams" });
  });
  it("asked of another place are corrected to the right one", () => {
    expect(correctedListsAddress("#/teams/services/dns-record-change")).toBe("#/service/dns-record-change");
    expect(correctedListsAddress("#/tools/services")).toBe("#/services");
    expect(correctedListsAddress("#/admin/teams/services/dns-record-change")).toBe("#/admin/services/dns-record-change");
    expect(correctedListsAddress("#/admin/services/services/dns-record-change")).toBe("#/admin/services/dns-record-change");
    for (const right of ["#/services", "#/service/dns-record-change", "#/admin/services", "#/admin/services/dns-record-change"]) expect(correctedListsAddress(right)).toBeNull();
  });
  it("name the page in the browser's title", () => {
    expect(pageTitle({ page: "services" }, {}, "Pattern Catalog")).toBe("Services · Pattern Catalog");
    expect(pageTitle({ page: "service", id: "x" }, { service: "DNS record change" }, "Pattern Catalog")).toBe("DNS record change · Pattern Catalog");
    expect(pageTitle({ page: "service", id: "x" }, {}, "Pattern Catalog")).toBe("Service not found · Pattern Catalog");
    expect(pageTitle({ page: "admin", section: "lists", place: "services" }, {}, "Pattern Catalog")).toBe("Services · Admin · Pattern Catalog");
  });
});
