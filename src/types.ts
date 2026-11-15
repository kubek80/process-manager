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

/** What processes and standards have in common: who owns them, where they apply, their life-cycle. */
export interface Governed {
  $schema?: string;
  schemaVersion: "1.0";
  id: string;
  title: string;
  summary: string;
  owner?: string;
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
  category?: string;
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
export interface Language { id: string; name: string; description?: string }
export type TeamKind = "team" | "security" | "platform" | "practice";
export interface Team { id: string; name: string; kind?: TeamKind; contact?: string; description?: string }
export interface Tool { id: string; name: string; url?: string; description?: string }
export interface Catalog { $schema?: string; tiers: Tier[]; environments: Environment[]; languages: Language[]; teams: Team[]; tools: Tool[] }

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
  standardUnits: string[];
  owns: string[];
}

export interface Me {
  authenticated: boolean;
  provider: "dev" | "entra" | "google";
  user?: { email: string; name: string };
  perms?: Perms;
  devUsers?: { email: string; name: string; about: string }[];
}

export type Role = "admin" | "catalog-manager" | "process-editor" | "standards-editor" | "owner";
export interface Assignment { email: string; role: Role; scope: string; grantedBy: string; grantedAt: string }
export interface AuditEntry { id: number; at: string; email: string; name: string; action: string; target: string; detail: string }
export interface DocVersion { version: number; savedAt: string; savedBy: string; deleted: boolean }

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
