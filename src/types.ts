export type StepType =
  | "form" | "code" | "approval" | "review" | "wait" | "communication" | "meeting"
  | "automation" | "document" | "verify" | "decision" | "subprocess" | "task";

export interface Actor { id: string; name: string; description?: string }
export interface Prerequisite { title: string; description?: string; url?: string; processId?: string }
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
  estimatedDuration?: string;
  tags?: string[];
  updatedAt?: string;
  prerequisites: Prerequisite[];
  actors: Actor[];
  steps: Step[];
}

export interface Issue { level: "error" | "warning"; path: string; message: string }
