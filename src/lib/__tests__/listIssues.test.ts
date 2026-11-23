import { describe, expect, it } from "vitest";
import type { Catalog, Issue } from "../../types";
import { issueText, listEntryWords, listIssueField, listIssuePlace, refusalText } from "../editing";
import { refusalIssues, validateCatalog } from "../validate";
import { catalog } from "./fixtures";

/**
 * Admin › Lists: every problem the lists can have reads as an instruction that names the list and
 * the entry by name - never by a path or an index - whether the app's checker found it or the
 * server refused the save.
 */
const lists = (change: (c: Record<string, any>) => void): Catalog => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = structuredClone(catalog) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  change(c);
  return c as unknown as Catalog;
};
/** What the person reads for each problem the checker finds in the lists. */
const words = (c: Catalog) => validateCatalog(c).map((i) => issueText(i, "lists", c));
const team = (c: Catalog, i: number) => c.teams[i].name;
const NO_PATH = /\[\d+\]|\/\w+\/\d+|\(root\)|must match|kebab|schema|minLength|maxLength/;

describe("the problems of the lists, in words", () => {
  it("an empty or missing name: give the entry a name, called by its id", () => {
    const c = lists((x) => { x.teams[0].name = ""; delete x.tiers[1].name; });
    expect(words(c)).toEqual([
      `Give the tier with the id “${c.tiers[1].id}” a name.`,
      `Give the team with the id “${c.teams[0].id}” a name.`,
    ]);
  });

  it("a name that is only spaces is empty too", () => {
    const c = lists((x) => { x.tools[0].name = "   "; });
    // the format counts spaces as a name; the page tidies them away before saving, so this is never seen
    expect(words(c)).toEqual([]);
  });

  it("too long: shorten that field of that entry, to how many characters", () => {
    const c = lists((x) => { x.teams[1].name = "N".repeat(70); x.teams[3].description = "d".repeat(601); x.categories[0].description = "d".repeat(201); x.teams[2].contact = "c".repeat(121); });
    expect(words(c)).toEqual([
      `Shorten the name of the team “${"N".repeat(57)}…” to at most 60 characters.`,
      `Shorten the other ways to reach them of the team “${team(c, 2)}” to at most 120 characters.`,
      `Shorten the description of the team “${team(c, 3)}” to at most 600 characters.`,
      `Shorten the description of the category “${c.categories[0].name}” to at most 200 characters.`,
    ]);
  });

  it("links: must start with https://, and say so when it holds spaces", () => {
    const c = lists((x) => {
      x.platforms[0].contacts = { slackUrl: "www.slack.com/x", chatUrl: "https://chat example", confluence: "ftp://wiki", page: "javascript:alert(1)", form: "forms" };
      x.tools[1].url = "intranet/tool";
    });
    const p = `the platform “${c.platforms[0].name}”`;
    expect(words(c)).toEqual([
      `The link to the Slack channel of ${p} must start with https://.`,
      `The link to the Chat space of ${p} must start with https:// and have no spaces.`,
      `The Confluence page of ${p} must start with https://.`,
      `The page link of ${p} must start with https://.`,
      `The request form of ${p} must start with https://.`,
      `The link of the tool “${c.tools[1].name}” must start with https://.`,
    ]);
  });

  it("a link or an email address that is too long", () => {
    const c = lists((x) => { x.practices[0].contacts = { page: "https://x.example.com/" + "a".repeat(300), email: "a".repeat(120) + "@example.com" }; });
    const p = `the practice “${c.practices[0].name}”`;
    expect(words(c)).toEqual([
      `Shorten the group email of ${p} to at most 120 characters.`,
      `Shorten the page link of ${p} to at most 300 characters.`,
    ]);
  });

  it("an email address that is not one", () => {
    const c = lists((x) => { x.teams[0].contacts = { email: "cloud at example.com" }; });
    expect(words(c)).toEqual([`The group email of the team “${team(c, 0)}” is not an email address: write one, like team@company.com.`]);
  });

  it("an empty Slack channel or Chat space: fill it in or leave it out", () => {
    const c = lists((x) => { x.teams[0].contacts = { slack: "", chat: "" }; });
    expect(words(c)).toEqual([
      `Fill in the Slack channel of the team “${team(c, 0)}”, or leave it out.`,
      `Fill in the Google Chat space of the team “${team(c, 0)}”, or leave it out.`,
    ]);
  });

  it("an icon that is not an uploaded image", () => {
    const c = lists((x) => { x.tools[0].icon = "terraform.svg"; x.languages[0].icon = "ABC"; });
    expect(words(c)).toEqual([
      `The icon of the language “${c.languages[0].name}” is not an image the portal knows: choose the image again, or remove the icon.`,
      `The icon of the tool “${c.tools[0].name}” is not an image the portal knows: choose the image again, or remove the icon.`,
    ]);
  });

  it("two entries of one list with the same id: remove one, both named", () => {
    const c = lists((x) => { x.tools.push({ id: x.tools[0].id, name: "Terraform Cloud" }); x.teams.push({ id: x.teams[0].id, name: " " }); });
    expect(words(c)).toEqual([
      `Two teams have the id “${c.teams[0].id}”: remove one of them.`,
      `Two tools have the id “${c.tools[0].id}” (“${c.tools[0].name}” and “Terraform Cloud”): remove one of them.`,
    ]);
  });

  it("two entries with the same id and the same name", () => {
    const c = lists((x) => { x.tools.push({ ...x.tools[0] }); });
    expect(words(c)).toEqual([`Two tools have the id “${c.tools[0].id}”, both called “${c.tools[0].name}”: remove one of them.`]);
  });

  it("an id that is missing or that the portal cannot use: remove the entry and add it again", () => {
    const c = lists((x) => { x.tiers[0].id = "Tier Zero"; delete x.environments[0].id; x.languages[0].id = ""; });
    expect(words(c)).toEqual([
      `The tier “${c.tiers[0].name}” has an id the portal cannot use (“Tier Zero”): remove it and add it again under the same name.`,
      `The environment “${c.environments[0].name}” has no id: remove it and add it again under the same name.`,
      `The language “${c.languages[0].name}” has no id: remove it and add it again under the same name.`,
    ]);
  });

  it("a detail or a list the portal does not know", () => {
    const c = lists((x) => { x.tools[2].owner = "me"; x.extra = []; });
    expect(words(c)).toEqual([
      "The lists hold “extra”, which the portal does not know: ask whoever looks after the portal to remove it.",
      `The tool “${c.tools[2].name}” has a detail the portal does not know (“owner”): ask whoever looks after the portal to remove it.`,
    ]);
  });

  it("a list that is missing or is not a list", () => {
    expect(words(lists((x) => { delete x.tools; }))).toEqual(["The list of tools is missing: ask whoever looks after the portal to put it back."]);
    expect(words(lists((x) => { x.languages = "Go"; }))).toEqual(["The list of languages is not in a form the portal can use: ask whoever looks after the portal."]);
  });

  it("anything nobody foresaw is still a sentence about its entry, never a path", () => {
    const c = lists((x) => { x.platforms[0].contacts = {}; x.tiers[0] = "Tier 0"; x.teams[0].name = 7; });
    const out = words(c);
    expect(out).toContain(`Check the contact details of the platform “${c.platforms[0].name}”: the portal cannot use what is there.`);
    expect(out).toContain(`Check the name of the team with the id “${c.teams[0].id}”: the portal cannot use what is there.`);
    expect(out).toContain("Check a tier without a name: the portal cannot use what is there.");
    expect(issueText({ level: "error", path: "teams[0].contacts.fax", message: "is odd" }, "lists", c)).toBe(`Check the fax of the team with the id “${c.teams[0].id}”: the portal cannot use what is there.`);
    expect(issueText({ level: "error", path: "(root)", message: "is odd" }, "lists", c)).toBe("The lists are not in a form the portal can use: ask whoever looks after the portal.");
    for (const text of out) { expect(text).not.toMatch(NO_PATH); expect(text).toMatch(/^[A-Z].*[.]$/); }
  });

  it("no sentence ever shows a path, an index or a schema word", () => {
    const c = lists((x) => {
      x.teams[0].name = ""; x.teams[1].contacts = { email: "x", slackUrl: "y" }; x.tools[0].icon = "z"; x.tools.push({ ...x.tools[1] }); x.tiers[0].id = "A B";
    });
    for (const text of words(c)) expect(text).not.toMatch(NO_PATH);
  });

  it("the sample lists have no problems", () => expect(validateCatalog(catalog)).toEqual([]));
});

describe("where a problem of the lists is", () => {
  it("names the list, the entry and the field", () => {
    expect(listIssuePlace("teams[3].contacts.slackUrl")).toEqual({ list: "teams", index: 3, field: "slackUrl", contact: true });
    expect(listIssuePlace("tools[0].url")).toEqual({ list: "tools", index: 0, field: "url" });
    expect(listIssuePlace("tiers[1]")).toEqual({ list: "tiers", index: 1, field: undefined });
    expect(listIssuePlace("(root)")).toEqual({});
    expect(listIssuePlace("steps[0].title")).toEqual({});
  });

  it("leads to the field on the page; an id cannot be changed, so to the name", () => {
    expect(listIssueField("teams[3].contacts.slackUrl")[0]).toBe('[data-contact-field="slackUrl"] input');
    expect(listIssueField("teams[3].description")).toContain('.contact-fields textarea[id$="-description"]');
    expect(listIssueField("tools[0].description")[0]).toBe('[data-field="description"]');
    expect(listIssueField("tools[0].url")).toEqual(['[data-field="url"]']);
    expect(listIssueField("tools[0].icon")).toEqual([".icon-field button"]);
    expect(listIssueField("teams[0].contact")).toEqual(['.contact-fields input[id$="-contact"]']);
    expect(listIssueField("tools[2].id")).toEqual(['[data-field="name"]']);
    expect(listIssueField("tiers[1]")).toEqual(['[data-field="name"]']);
  });

  it("calls an entry by its name, else its id", () => {
    expect(listEntryWords(catalog, "platforms", 0)).toBe(`the platform “${catalog.platforms[0].name}”`);
    expect(listEntryWords({ environments: [{ id: "prod", name: " " }] }, "environments", 0)).toBe("the environment with the id “prod”");
    expect(listEntryWords({ environments: [{}] }, "environments", 0)).toBe("an environment without a name");
    expect(listEntryWords(undefined, "tools", 4)).toBe("a tool without a name");
  });
});

describe("a save of the lists the server refused", () => {
  const c = lists((x) => { x.teams[0].name = ""; });
  it("reads like the app's own check: the format's problems", () => {
    const error = "does not match the format: /teams/0/name: minLength: got 0, want 1; /teams/1/contacts/slackUrl: 'www.x' does not match pattern '^https?://\\\\S+$'; /teams/1/contacts/email: 'bad' does not match pattern '^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$' (and 3 more)";
    const r = refusalIssues(error)!;
    expect(r.more).toBe(3);
    expect(r.issues.map((i) => [i.path, i.message])).toEqual([
      ["teams[0].name", "is empty"],
      ["teams[1].contacts.slackUrl", "must be a full link starting with http:// or https://"],
      ["teams[1].contacts.email", "must be an email address"],
    ]);
    expect(refusalText(error, "lists", c)).toBe(
      `Give the team with the id “${c.teams[0].id}” a name. The link to the Slack channel of the team “${team(c, 1)}” must start with https://. ` +
      `The group email of the team “${team(c, 1)}” is not an email address: write one, like team@company.com. And 3 more to fix.`);
  });

  it("the format's other words", () => {
    const parts = (m: string) => refusalIssues(`does not match the format: /tools/0${m}`)!.issues[0];
    expect(parts("/name: maxLength: got 70, want 40")).toMatchObject({ path: "tools[0].name", message: "is too long (maximum 40 characters)" });
    expect(parts("/name: minLength: got 2, want 3")).toMatchObject({ message: "is too short (minimum 3 characters)" });
    expect(parts(": missing property 'name'")).toMatchObject({ path: "tools[0]", message: 'is missing the required field "name"' });
    expect(parts(": additional properties 'owner' not allowed")).toMatchObject({ message: 'has a field "owner" that the schema does not allow - remove or rename it' });
    expect(parts("/id: 'A B' does not match pattern '^[a-z0-9]+(-[a-z0-9]+)*$'")).toMatchObject({ message: expect.stringContaining("kebab-case") });
    expect(parts("/name: got number, want string")).toMatchObject({ message: "must be of type string" });
  });

  it("the server's own sentences, with or without their place", () => {
    const error = "tools[3].id: Two tools have the id “terraform” (“Terraform” and “TF”): remove one of them.; The group email of the team “A” is not an email address: write one, like team@company.com.";
    expect(refusalText(error, "lists", c)).toBe("Two tools have the id “terraform” (“Terraform” and “TF”): remove one of them. The group email of the team “A” is not an email address: write one, like team@company.com.");
  });

  it("anything else is shown as the server said it", () => {
    expect(refusalIssues("cannot remove what is still in use: the tool “X” (“Y”). Change those first.")).toBeNull();
    expect(refusalText("cannot remove what is still in use: the tool “X” (“Y”). Change those first.", "lists", c)).toBe("Cannot remove what is still in use: the tool “X” (“Y”). Change those first.");
    expect(refusalText("The icon of the tool “Terraform” has not been uploaded. Choose the image again.", "lists", c)).toBe("The icon of the tool “Terraform” has not been uploaded. Choose the image again.");
  });
});

describe("the JSON of a process or a standard", () => {
  it("a problem keeps the editing screen's words", () => {
    const i: Issue = { level: "error", path: "id", message: "The id must stay “request-gcp-project”: the process is known by it." };
    expect(issueText(i, "process")).toBe(i.message);
  });
});
