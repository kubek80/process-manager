import { describe, expect, it } from "vitest";
import type { Catalog, Process } from "../../types";
import { ownedBy } from "../catalog";
import {
  belongsHeading, belongsToGroup, contactProblems, contactsOk, contactView, countByKind, groupEntry, groupFilter, isWebLink, rankText,
  addedNote, nameFromMembers, ownFirst, repeatsDetail, shortLink, splitOwnerLine, summaryLine, tidyContacts, withScheme,
} from "../groups";
import { search } from "../search";
import { href, pageTitle, parseRoute, type Route } from "../store";
import { catalog, processes, standards } from "./fixtures";

const doc = (over: Partial<Process>): Process => ({ id: "x", title: "X", summary: "", actors: [], steps: [], ...over }) as unknown as Process;

describe("the address of a group's page", () => {
  it("leads back to the same group", () => {
    const routes: Route[] = [
      { page: "group", kind: "platform", id: "gcp" }, { page: "group", kind: "practice", id: "engineering" }, { page: "group", kind: "team", id: "cloud-platform" },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
    expect(href({ page: "group", kind: "platform", id: "gcp" })).toBe("#/platform/gcp");
  });
  it("is not confused with other addresses", () => {
    expect(parseRoute("#/platform/")).toEqual({ page: "home" });
    expect(parseRoute("#/platform/Not_An_Id")).toEqual({ page: "home" });
    expect(parseRoute("#/team/cloud-platform/")).toEqual({ page: "group", kind: "team", id: "cloud-platform" });
  });
  it("names the group in the browser tab, and says when it does not exist", () => {
    expect(pageTitle({ page: "group", kind: "platform", id: "gcp" }, { group: "Google Cloud" }, "Portal")).toBe("Google Cloud · Portal");
    expect(pageTitle({ page: "group", kind: "practice", id: "gone" }, {}, "Portal")).toBe("Practice not found · Portal");
    expect(pageTitle({ page: "group", kind: "team", id: "gone" }, { loading: true }, "Portal")).toBe("Portal");
  });
});

describe("what belongs to a group", () => {
  it("is what names the platform or practice, and for a team what it owns", () => {
    expect(belongsToGroup("platform", "gcp", { platform: "gcp" })).toBe(true);
    expect(belongsToGroup("platform", "gcp", { practice: "gcp" })).toBe(false);
    expect(belongsToGroup("practice", "eng", { practice: "eng" })).toBe(true);
    expect(belongsToGroup("team", "cloud", { owner: "cloud" })).toBe(true);
    expect(belongsToGroup("team", "cloud", { platform: "cloud" })).toBe(false);
    expect(belongsToGroup("team", "", { owner: "" })).toBe(false);
  });
  it("is found by the same filter as the search, so the page and “Open in the search” agree", () => {
    for (const kind of ["team", "platform", "practice"] as const) {
      const list = kind === "team" ? catalog.teams : kind === "platform" ? catalog.platforms : catalog.practices;
      for (const g of list) {
        const found = search({ processes, standards, catalog, filters: groupFilter(kind, g.id), drafts: true }).results;
        const expected = [...processes, ...standards].filter((d) => belongsToGroup(kind, g.id, d));
        expect(found.map((r) => r.doc.id).sort()).toEqual(expected.map((d) => d.id).sort());
      }
    }
    expect(groupFilter("team", "a")).toEqual({ owner: ["a"] });
    expect(groupFilter("platform", "a")).toEqual({ platform: ["a"] });
    expect(groupFilter("practice", "a")).toEqual({ practice: ["a"] });
  });
  it("keeps a draft away from whoever the server did not send it to (the search leaves drafts out when told to)", () => {
    const draft = doc({ id: "secret", platform: "gcp", status: "draft" } as Partial<Process>);
    const shown = (drafts: boolean) => search({ processes: [draft], standards: [], catalog, filters: groupFilter("platform", "gcp"), drafts }).results.length;
    expect(shown(true)).toBe(1);
    expect(shown(false)).toBe(0);
  });
  it("is counted by kind", () => {
    expect(countByKind([{ kind: "process" }, { kind: "standard" }, { kind: "process" }])).toEqual({ process: 2, standard: 1 });
    expect(countByKind([])).toEqual({ process: 0, standard: 0 });
  });
  it("has a heading for each kind", () => {
    expect(belongsHeading("team")).toBe("What this team looks after");
    expect(belongsHeading("platform")).toBe("What belongs to this platform");
    expect(belongsHeading("practice")).toBe("What belongs to this practice");
  });
  it("is found only for an entry the lists have", () => {
    const c = { ...catalog, platforms: [{ id: "gcp", name: "Google Cloud" }] } as Catalog;
    expect(groupEntry(c, "platform", "gcp")?.name).toBe("Google Cloud");
    expect(groupEntry(c, "platform", "nope")).toBeUndefined();
    expect(groupEntry(c, "practice", "gcp")).toBeUndefined();
  });
});

describe("the mark for the person signed in", () => {
  it("says owner or member, and nothing for everybody else", () => {
    expect(rankText("owner")).toBe("You are an owner");
    expect(rankText("member")).toBe("You are a member");
    expect(rankText(undefined)).toBe("");
  });
});

describe("links people typed", () => {
  it("are http or https only, without spaces, as the server checks them", () => {
    expect(isWebLink("https://example.com/page")).toBe(true);
    expect(isWebLink("http://example.com")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink("ftp://example.com")).toBe(false);
    expect(isWebLink("https://exa mple.com")).toBe(false);
    expect(isWebLink("HTTPS://example.com")).toBe(false); // the server's pattern is lower case
    expect(isWebLink("example.com")).toBe(false);
    expect(isWebLink(`https://example.com/${"a".repeat(300)}`)).toBe(false);
    expect(isWebLink(undefined)).toBe(false);
  });
  it("say what is wrong on the field, in plain words", () => {
    expect(contactProblems({ email: "team@example.com", slackUrl: "https://x.slack.com/archives/C1", form: "" })).toEqual({});
    const p = contactProblems({ email: "not an email", slackUrl: "slack.com/x", confluence: "https://wiki example", page: "javascript:alert(1)", slack: "#".repeat(81) });
    expect(p.email).toBe("Write one email address, like team@company.com.");
    expect(p.slackUrl).toBe("Write the whole link, starting with https://");
    expect(p.confluence).toBe("Write the link without spaces.");
    expect(p.page).toBe("Write the whole link, starting with https://");
    expect(p.slack).toBe("Shorten it to 80 characters or fewer.");
    expect(contactsOk({ email: "a@b.co" })).toBe(true);
    expect(contactsOk({ form: "www.example.com" })).toBe(false);
    expect(contactsOk(undefined)).toBe(true);
  });
  it("are kept without empty details and spaces around", () => {
    expect(tidyContacts({ email: " a@b.co ", slack: "", page: "  " })).toEqual({ email: "a@b.co" });
    expect(tidyContacts({ slack: " " })).toBeUndefined();
    expect(tidyContacts(undefined)).toBeUndefined();
  });
  it("are shown short", () => {
    expect(shortLink("https://www.example.com/wiki/")).toBe("example.com/wiki");
    expect(shortLink("http://example.com/a/b")).toBe("example.com/a/b");
  });
});

describe("how to reach a group", () => {
  it("shows each detail as what it is, in a fixed order, the request form on its own", () => {
    const v = contactView({
      contact: "Office hours on Tuesdays",
      contacts: {
        form: "https://forms.example.com/ask", page: "https://example.com/team", confluence: "https://wiki.example.com/x",
        chat: "Cloud questions", chatUrl: "https://chat.google.com/room/1", slack: "#cloud", slackUrl: "https://example.slack.com/archives/C1", email: "cloud@example.com",
      },
    });
    expect(v.form).toBe("https://forms.example.com/ask");
    expect(v.items.map((i) => i.key)).toEqual(["email", "slack", "chat", "confluence", "page"]);
    expect(v.items[0]).toEqual({ key: "email", label: "Group email", text: "cloud@example.com", href: "mailto:cloud@example.com" });
    expect(v.items[1]).toMatchObject({ label: "Slack channel", text: "#cloud", href: "https://example.slack.com/archives/C1", external: true });
    expect(v.items[2]).toMatchObject({ label: "Google Chat space", text: "Cloud questions", href: "https://chat.google.com/room/1" });
    expect(v.items[3]).toMatchObject({ label: "Confluence page", text: "wiki.example.com/x" });
    expect(v.items[4]).toMatchObject({ label: "Their page", text: "example.com/team" });
    expect(v.other).toBe("Office hours on Tuesdays");
    expect(v.none).toBe(false);
  });
  it("draws the plain name when there is no link, and a link alone with words of its own", () => {
    const v = contactView({ contacts: { slack: "#cloud", chatUrl: "https://chat.google.com/room/1" } });
    expect(v.items).toEqual([
      { key: "slack", label: "Slack channel", text: "#cloud" },
      { key: "chat", label: "Google Chat space", text: "Open the space", href: "https://chat.google.com/room/1", external: true },
    ]);
  });
  it("never draws a link from a value that fails the check", () => {
    const v = contactView({ contacts: { slack: "#cloud", slackUrl: "javascript:alert(1)", page: "javascript:alert(1)", form: "data:text/html,x", email: "nope" } });
    expect(v.form).toBeUndefined();
    expect(v.items).toEqual([
      { key: "email", label: "Group email", text: "nope" },
      { key: "slack", label: "Slack channel", text: "#cloud" },
    ]);
    expect(v.items.some((i) => i.href?.startsWith("javascript"))).toBe(false);
  });
  it("shows nothing for what is empty, and says when nothing at all is known", () => {
    expect(contactView({ contacts: { email: " " }, contact: "" })).toEqual({ form: undefined, items: [], other: undefined, none: true });
    expect(contactView(undefined).none).toBe(true);
    expect(contactView({ contact: "Ask in the kitchen" })).toMatchObject({ items: [], other: "Ask in the kitchen", none: false });
  });
});

describe("the one line of a row in Teams & tools", () => {
  it("says how to reach them first: the Slack channel, the group email, the Chat space, the free line", () => {
    expect(summaryLine({ contacts: { email: "a@b.co", slack: "#cloud" }, contact: "x", description: "d" })).toBe("Slack #cloud");
    expect(summaryLine({ contacts: { email: "a@b.co", chat: "Space" }, description: "d" })).toBe("Email a@b.co");
    expect(summaryLine({ contacts: { chat: "Space" }, contact: "x" })).toBe("Chat Space");
    expect(summaryLine({ contact: "Slack #old", description: "d" })).toBe("Slack #old");
  });
  it("else what it is, a tool's link, or that nothing is known", () => {
    expect(summaryLine({ url: "https://www.example.com/" })).toBe("example.com");
    expect(summaryLine({ description: "A platform" })).toBe("A platform");
    expect(summaryLine({ contacts: {}, contact: " " })).toBe("No details yet");
  });
});

describe("the owner line of a page head", () => {
  it("keeps ownedBy's words and cuts out the team's name for its link", () => {
    const c = { ...catalog, categories: [{ id: "cloud", name: "Cloud" }], teams: [{ id: "cp", name: "Cloud Platform team" }] } as Catalog;
    const said = ownedBy(c, "process", { category: "cloud", owner: "cp" });
    expect(splitOwnerLine(said, "Cloud Platform team")).toEqual({ before: "Cloud · Owned by ", team: "Cloud Platform team" });
    expect(splitOwnerLine(ownedBy(c, "standard", { owner: "cp" }), "Cloud Platform team")).toEqual({ before: "Issued by ", team: "Cloud Platform team" });
    expect(splitOwnerLine("Cloud", "")).toEqual({ before: "Cloud", team: "" });
    expect(splitOwnerLine("Cloud", "Elsewhere")).toEqual({ before: "Cloud", team: "" });
  });
});


import { tidyLists } from "../groups";
import { hasErrors, validateCatalog } from "../validate";

describe("Admin › Lists saves how to reach a group", () => {
  const withContacts = (contacts: Catalog["platforms"][number]["contacts"]): Catalog => {
    const c = structuredClone(catalog) as Catalog;
    c.platforms = c.platforms.map((p, i) => (i === 0 ? { ...p, contacts } : i === 1 ? { ...p, contacts: { slack: "#other" } } : p));
    return c;
  };
  it("keeps the filled details and leaves an emptied one out", () => {
    const filled = withContacts({ email: "cloud@example.com", slack: "#cloud", slackUrl: "https://chat.example.com/c", chat: "Cloud", page: "https://cloud.example.com" });
    const cleared = withContacts({ ...filled.platforms[0].contacts, slack: "", chat: "  ", slackUrl: "", page: "" });
    const saved = tidyLists(cleared);
    expect(saved.platforms[0].contacts).toEqual({ email: "cloud@example.com" });
    expect(saved.platforms[1].contacts).toEqual({ slack: "#other" }); // the others are not dropped
    expect(hasErrors(validateCatalog(saved))).toBe(false);
    expect(tidyLists(filled).platforms[0].contacts).toEqual(filled.platforms[0].contacts);
  });
  it("leaves the contact details out entirely when every field is cleared, with nothing to refuse", () => {
    const saved = tidyLists(withContacts({ email: "", slack: "", slackUrl: "", chat: "", chatUrl: "", confluence: "", page: "", form: "" }));
    expect("contacts" in saved.platforms[0]).toBe(false);
    expect(saved.platforms[0].id).toBe(catalog.platforms[0].id);
    expect(saved.platforms[0].name).toBe(catalog.platforms[0].name);
    expect(hasErrors(validateCatalog(saved))).toBe(false);
  });
  it("is what the format refuses without it: an empty Slack channel", () => {
    expect(hasErrors(validateCatalog(withContacts({ slack: "" })))).toBe(true);
  });
});

describe("the old free line beside the new details", () => {
  it("is left out when it only repeats one of them (without case, spaces, # and the word Slack)", () => {
    expect(repeatsDetail("Slack #cloud-platform", { slack: "#cloud-platform" })).toBe(true);
    expect(repeatsDetail("slack: #Cloud-Platform", { slack: "#cloud-platform" })).toBe(true);
    expect(repeatsDetail("cloud@example.com", { email: "Cloud@example.com" })).toBe(true);
    expect(repeatsDetail("Slack #cloud-platform or the queue", { slack: "#cloud-platform" })).toBe(false);
    expect(repeatsDetail("Slack #cloud-platform", undefined)).toBe(false);
    expect(contactView({ contact: "Slack #cloud", contacts: { slack: "#cloud" } }).other).toBeUndefined();
    expect(contactView({ contact: "Office hours", contacts: { slack: "#cloud" } }).other).toBe("Office hours");
  });
});

describe("a link typed without its beginning", () => {
  it("gets https:// when it looks like a host or a path", () => {
    expect(withScheme("example.atlassian.net/wiki/x")).toBe("https://example.atlassian.net/wiki/x");
    expect(withScheme("www.example.com")).toBe("https://www.example.com");
    expect(withScheme(" intranet.example.com:8443/a?b=c ")).toBe("https://intranet.example.com:8443/a?b=c");
  });
  it("is left alone when it names a scheme, has spaces or is not a host", () => {
    for (const v of ["https://example.com", "http://example.com", "ftp://example.com", "mailto:a@b.co", "javascript:alert(1)", "wiki page", "example", "", "a b.com"]) expect(withScheme(v)).toBe(v);
  });
});

describe("the order of a list in Teams & tools", () => {
  it("puts the person's own entries first, then by name", () => {
    const rows = [{ id: "z", name: "Zeta" }, { id: "a", name: "alpha" }, { id: "m", name: "Mid" }, { id: "b", name: "Beta" }];
    expect(ownFirst(rows, (id) => id === "m" || id === "z").map((r) => r.id)).toEqual(["m", "z", "a", "b"]);
    expect(ownFirst(rows, () => false).map((r) => r.id)).toEqual(["a", "b", "m", "z"]);
  });
});

describe("what adding somebody answered", () => {
  it("speaks to the person about themselves, and passes the server's note on otherwise", () => {
    expect(addedNote({ note: "jordan@example.com is already an owner …", self: true, selfRank: "owner", group: "Google Cloud" })).toBe("You are already an owner of Google Cloud.");
    expect(addedNote({ note: "x", self: true, selfRank: "member", group: "Engineering" })).toBe("You are already a member of Engineering.");
    expect(addedNote({ note: "ann@example.com is already a member of the platform “Google Cloud”: nothing changed.", self: false, group: "Google Cloud" })).toBe("ann@example.com is already a member of the platform “Google Cloud”: nothing changed.");
  });
});

describe("the name of somebody just added", () => {
  it("comes from what the portal knows of people, whatever the case of the address; nothing for a stranger", () => {
    const members = [{ email: "sam@example.com", role: "platform-owner", scope: "azure", name: "Sam Consumer" }, { email: "kim@example.com", role: "owner", scope: "x" }];
    expect(nameFromMembers(members, "Sam@Example.com ")).toBe("Sam Consumer");
    expect(nameFromMembers(members, "kim@example.com")).toBeUndefined();
    expect(nameFromMembers(members, "quinn@example.com")).toBeUndefined();
    expect(nameFromMembers(undefined, "sam@example.com")).toBeUndefined();
  });
});

describe("the address of Teams & tools", () => {
  it("carries the list and the entry, and the old address still works", () => {
    const routes: Route[] = [{ page: "catalog" }, { page: "catalog", list: "platforms" }, { page: "catalog", list: "platforms", id: "google-cloud" }];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
    expect(href({ page: "catalog", list: "teams", id: "cloud-platform-team" })).toBe("#/catalog/teams/cloud-platform-team");
    expect(parseRoute("#/catalog")).toEqual({ page: "catalog" });
    expect(parseRoute("#/catalog/nonsense/x")).toEqual({ page: "catalog" });
  });
});
