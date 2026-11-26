import type { Catalog, PatternEntry } from "../types";
import { otherNameClashes, pathsOf, pathTitle, pathWords } from "./paths";

/**
 * The architecture patterns (microservices, event-driven…): a list an organisation fills itself,
 * and on a process or standard a tag (`"patterns"`): it is about systems built that way. Unlike the
 * path, a pattern never means "meant only for": a document without patterns is simply not tagged,
 * and nothing is hidden from anybody because of them. Their names and other names are found by the
 * word search (`patternWords`) and, on the server, by the chunk text (`docs.PatternNames`).
 */

/** "Architecture pattern" for one, "Architecture patterns" for the list: the words readers see. */
export const PATTERN_WORDS = { one: "architecture pattern", many: "architecture patterns" } as const;

/** The words a pattern is found by: its name and its other names ("EDA" finds what is tagged Event-driven). */
export const patternWords = (entry: Pick<PatternEntry, "name" | "alsoCalled">): string[] => pathWords(entry);

/** A pattern with its other names, for a tooltip: "Event-driven, also called event-based or EDA". */
export const patternTitle = (entry: Pick<PatternEntry, "name" | "alsoCalled">): string => pathTitle(entry);

/** The patterns a document names, in the order of the list; an id the list does not have under its id, after the others. */
export const patternsOf = (list: PatternEntry[] | undefined, ids: unknown): PatternEntry[] => pathsOf<PatternEntry>(list, ids);

/** The patterns of a document in words, in the order of the list: "Event-driven, Microservices"; "" when it names none. */
export const patternLabel = (c: Pick<Catalog, "patterns">, ids: unknown): string => patternsOf(c.patterns, ids).map((e) => e.name).join(", ");

/** Other names that two patterns claim, or that are another pattern's name (see `otherNameClashes`). */
export const patternNameClashes = (patterns: PatternEntry[] | undefined) => otherNameClashes(patterns, { one: PATTERN_WORDS.one, many: PATTERN_WORDS.many });
