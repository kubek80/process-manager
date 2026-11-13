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

export interface Process {
  $schema?: string;
  schemaVersion: "1.0";
  id: string;
  title: string;
  summary: string;
  category?: string;
  owner?: string;
  tiers?: string[];
  languages?: string[];
  estimatedDuration?: string;
  tags?: string[];
  updatedAt?: string;
  status?: Status;
  replacedBy?: string;
  review?: Review;
  resources?: Resource[];
  prerequisites: Prerequisite[];
  actors: Actor[];
  steps: Step[];
}

export interface Issue { level: "error" | "warning"; path: string; message: string }

export interface Tier { id: string; name: string; description?: string }
export interface Team { id: string; name: string; contact?: string; description?: string }
export interface Language { id: string; name: string; description?: string }
export interface Tool { id: string; name: string; url?: string; description?: string }
export interface Catalog { $schema?: string; tiers: Tier[]; languages: Language[]; teams: Team[]; tools: Tool[] }

export type FeedbackKind = "broken" | "outdated" | "unclear" | "idea";
export interface Feedback {
  id: string;
  stepId?: string;
  kind: FeedbackKind;
  text: string;
  author?: string;
  createdAt: string;
  resolved?: boolean;
}
