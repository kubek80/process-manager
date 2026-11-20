export type StepType =
  | "form" | "code" | "approval" | "review" | "wait" | "communication" | "meeting"
  | "automation" | "document" | "verify" | "decision" | "subprocess" | "task";

export interface Actor { id: string; name: string; description?: string; teamId?: string }
export interface Prerequisite { title: string; description?: string; url?: string; processId?: string }
export type ResourceKind = "skill" | "repository" | "template" | "documentation" | "other";
export interface Resource { title: string; url: string; kind?: ResourceKind; description?: string }
export interface Review { intervalMonths: number; lastReviewedAt?: string; reviewedBy?: string }
export type Status = "draft" | "active" | "deprecated";
export interface NextLink { to: string; label?: string }

export interface Step {
  id: string;
  title: string;
  actor: string;
  type: StepType;
  description?: string;
  instructions?: string[];
  tool?: string;
  url?: string;
  urlLabel?: string;
  duration?: string;
  outcome?: string;
  resources?: Resource[];
  subProcessId?: string;
  next: NextLink[];
}

/** How binding a process is. For a standard it follows from the levels of its requirements. */
export type Rigour = "mandatory" | "recommended" | "optional";

/** What processes and standards have in common: who owns them, what they belong to, where they apply, their life-cycle. */
export interface Governed {
  $schema?: string;
  schemaVersion: "1.0";
  id: string;
  title: string;
  summary: string;
  /** The team that maintains it: asked to review it and to answer feedback. */
  owner?: string;
  /** Id of a category from the lists. */
  category?: string;
  /** Id of the practice it belongs to. The owners of the practice may change it. */
  practice?: string;
  /** Id of the platform it belongs to. The owners of the platform may change it. */
  platform?: string;
  tiers?: string[];
  languages?: string[];
  environments?: string[];
  tags?: string[];
  updatedAt?: string;
  status?: Status;
  replacedBy?: string;
  review?: Review;
  resources?: Resource[];
}

export interface Process extends Governed {
  rigour?: Rigour;
  estimatedDuration?: string;
  standards?: string[];
  prerequisites: Prerequisite[];
  actors: Actor[];
  steps: Step[];
}

export type Level = "must" | "should" | "may";
export type VerificationMethod = "automated" | "review" | "manual";
export type Severity = "blocker" | "warning" | "info";

export interface Requirement {
  id: string;
  title: string;
  level: Level;
  statement: string;
  rationale?: string;
  guidance?: string[];
  examples?: { good?: string[]; bad?: string[] };
  verification: { method: VerificationMethod; description?: string };
  review?: { lookFor: string[]; paths?: string[]; severity?: Severity };
  tiers?: string[];
  languages?: string[];
  environments?: string[];
  processId?: string;
}

export interface Standard extends Governed {
  owner: string;
  scope?: string;
  exceptionProcessId?: string;
  requirements: Requirement[];
}

export interface Issue { level: "error" | "warning"; path: string; message: string }

export interface Tier { id: string; name: string; description?: string }
export interface Environment { id: string; name: string; description?: string }
/** `icon`: id of an uploaded square image (see `iconUrl` in the store). */
export interface Language { id: string; name: string; icon?: string; description?: string }
export interface Team { id: string; name: string; contact?: string; description?: string }
export interface Practice { id: string; name: string; contact?: string; description?: string }
export interface Platform { id: string; name: string; contact?: string; description?: string }
export interface Category { id: string; name: string; description?: string }
export interface Tool { id: string; name: string; icon?: string; url?: string; description?: string }
/** The lists. `practices`, `platforms` and `categories` are always present in the app (the loader fills in empty ones). */
export interface Catalog {
  $schema?: string;
  tiers: Tier[]; environments: Environment[]; languages: Language[];
  teams: Team[]; practices: Practice[]; platforms: Platform[]; categories: Category[];
  tools: Tool[];
}

export type TargetKind = "process" | "standard";
export type FeedbackKind = "broken" | "outdated" | "unclear" | "idea";
/** A feedback item as the signed-in user sees it (the server decides mine / canManage / stale). */
export interface Feedback {
  id: string;
  targetKind: TargetKind;
  targetId: string;
  itemId?: string; // a step of a process, or a requirement of a standard
  kind: FeedbackKind;
  text: string;
  author: { name: string; email: string };
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  alsoHit: number;
  alsoHitByMe: boolean;
  stale: boolean;
  mine: boolean;
  canManage: boolean;
}
export type FeedbackByTarget = Record<TargetKind, Record<string, Feedback[]>>;

/** What the signed-in person may do. Worked out by the server from their roles. */
export interface Perms {
  admin: boolean;
  catalog: boolean;
  processes: boolean;
  standards: boolean;
  /** Teams this person is Owner for: confirms reviews and answers feedback on what the team owns. */
  owns: string[];
  /** Platforms this person is owner of: may change the processes and standards that belong to them. */
  platforms: string[];
  /** Practices this person is owner of: may change the processes and standards that belong to them. */
  practices: string[];
}

export interface Me {
  authenticated: boolean;
  provider: "dev" | "entra" | "google";
  user?: { email: string; name: string };
  perms?: Perms;
  devUsers?: { email: string; name: string; about: string }[];
  /**
   * Search by meaning: whether the server offers it, and whether what is searched for is sent to
   * an outside service (Google Cloud) to be compared, and which provider compares (absent when
   * it is off, and from an older server). Missing from an older server: not offered.
   */
  search?: { meaning: boolean; outside: boolean; provider?: "builtin" | "vertex" };
}

export type Role = "admin" | "catalog-manager" | "process-editor" | "standards-editor" | "owner" | "platform-owner" | "practice-owner";
/** A person in one of the groups people belong to. Readable by everyone who is signed in. */
export interface Membership { email: string; role: "owner" | "platform-owner" | "practice-owner"; scope: string }
export interface Assignment { email: string; role: Role; scope: string; grantedBy: string; grantedAt: string }
export interface AuditEntry { id: number; at: string; email: string; name: string; action: string; target: string; detail: string }
export interface DocVersion {
  version: number; savedAt: string; savedBy: string; note: string; deleted: boolean;
  /** The name of whoever saved it, where the portal knows it. */
  savedByName?: string;
}
/** What the server knows about a document besides its content. */
export interface DocMeta {
  version: number; updatedAt: string; updatedBy: string;
  /** The name of whoever saved it last, where the portal knows it. */
  updatedByName?: string;
  /** When the first version was saved. */
  createdAt: string;
  /** When readers could first see it (its first version that was not a draft); none while it was never published. */
  publishedAt?: string;
  /** Unpublished changes exist. Only sent to people who may edit the process or standard. */
  draft?: { updatedAt: string; updatedBy: string; updatedByName?: string };
}

export interface Skill {
  id: string;
  kind: "skill" | "review-agent";
  sourceKind: TargetKind;
  sourceId: string;
  title: string;
  extra: string;
  active: boolean;
  version: number;
  updatedAt: string;
  path: string;
}
export interface SkillDetail { skill: Skill; content: string; versions: { version: number; sourceVersion: number; createdAt: string }[]; canEdit: boolean }
