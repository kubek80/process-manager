import type { Area, CodeCategory } from "./types";
import { tables } from "./categories/tables";
import { saving } from "./categories/saving";
import { vectors } from "./categories/vectors";
import { search } from "./categories/search";
import { mcp } from "./categories/mcp";
import { signin } from "./categories/signin";
import { rights } from "./categories/rights";
import { api } from "./categories/api";
import { skills } from "./categories/skills";
import { records } from "./categories/records";
import { formats } from "./categories/formats";
import { frame } from "./categories/frame";
import { look } from "./categories/look";
import { reading } from "./categories/reading";
import { editing } from "./categories/editing";
import { people } from "./categories/people";
import { admin } from "./categories/admin";
import { tests } from "./categories/tests";
import { deploy } from "./categories/deploy";
import { codemap } from "./categories/codemap";

export type { Area, CodeCategory, CodeChart, CodeExample, CodeFile, CodeTable, Requirement, TableColumn } from "./types";

/** The areas, in the order they are shown, with their names. */
export const AREAS: { id: Area; title: string; hint: string }[] = [
  { id: "data", title: "Data", hint: "What is stored, how a save becomes rows, and how rows become vectors" },
  { id: "server", title: "Server", hint: "The Go server: who may do what, and what it answers" },
  { id: "app", title: "App", hint: "The React app in the browser" },
  { id: "around", title: "Around the code", hint: "Tests, running it, and this page" },
];

/** Every category, in the order it is shown. */
export const CATEGORIES: CodeCategory[] = [tables, saving, vectors, search, mcp, signin, rights, api, skills, records, formats, frame, look, reading, editing, people, admin, tests, deploy, codemap];
