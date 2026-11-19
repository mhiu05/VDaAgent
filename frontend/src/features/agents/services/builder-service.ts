import type { ServiceResult } from "../../../shared/contracts/service-result";
import type { AgentAvatar, AgentStatus } from "../../chat/services/agent-chat-service";

/** The agent builder and folder viewer (docs 05, 04 "Folder viewer", 15 "Agents and builder"). */
export interface BuilderAgent {
  id: string;
  slug: string;
  name: string;
  avatar: { emoji: string; color: string };
  description: string;
  origin: string;
  isLead: boolean;
  status: AgentStatus;
  statusDetail: string | null;
  createdAt: string;
}

export interface NewAgent {
  slug: string;
  name: string;
  avatar: { emoji: string; color: string };
  description: string;
  starter?: string;
  presets: string[];
  credentials: string[];
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export interface BuilderJob {
  id: string;
  agentId: string | null;
  kind: string;
  status: JobStatus;
  output: string;
}

export interface InstalledSkill { name: string; description: string; catalogId: string | null; author: string | null }
export interface CatalogSkill { id: string; name: string; title: string; description: string; tags: string[] }
export interface SkillPreview { skillMd: string; files: string[]; hasCode: boolean }
export interface Preset { id: string; title: string; description: string; packages: string[] }
export interface Package { name: string; spec: string }
export interface Routine {
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  nextFires: string[];
  lastStartedAt: string | null;
  lastEndedAt: string | null;
  error: string | null;
}
export interface CredentialSet { set: string; description: string; keys: string[] }
export interface Starter {
  slug: string; name: string; avatar: { emoji: string; color: string }; description: string;
  presets: string[]; credentials: string[];
}

export interface TreeEntry {
  name: string;
  type: "file" | "dir" | "symlink";
  size: number | null;
  mtime: string | null;
  items: number | null;
  symlinkTarget: string | null;
}
export interface Commit { commit: string; author: string; message: string; at: string; execId: string | null }
export type FileContent =
  | { kind: "text"; text: string; mediaType: string }
  | { kind: "image"; url: string }
  | { kind: "binary"; url: string };

type R<T> = Promise<ServiceResult<T>>;

export interface AgentBuilderService {
  agents(signal?: AbortSignal): R<BuilderAgent[]>;
  agent(id: string, signal?: AbortSignal): R<BuilderAgent>;
  updateAgent(id: string, patch: Partial<Pick<BuilderAgent, "name" | "avatar" | "description">>): R<BuilderAgent>;
  deleteAgent(id: string): R<null>;
  create(agent: NewAgent): R<string>;
  reset(id: string): R<string>;
  job(id: string, signal?: AbortSignal): R<BuilderJob>;
  onJob(listener: (job: BuilderJob) => void): () => void;

  prompt(id: string, signal?: AbortSignal): R<{ text: string; commit: string | null }>;
  savePrompt(id: string, text: string): R<{ text: string; commit: string | null }>;

  skills(id: string, signal?: AbortSignal): R<InstalledSkill[]>;
  catalogSkills(signal?: AbortSignal): R<CatalogSkill[]>;
  skillPreview(skillId: string, signal?: AbortSignal): R<SkillPreview>;
  installSkill(id: string, source: { catalogId: string } | { url: string }): R<string>;
  removeSkill(id: string, name: string): R<string>;

  presets(signal?: AbortSignal): R<Preset[]>;
  packages(id: string, signal?: AbortSignal): R<Package[]>;
  addPackages(id: string, source: { presetId: string } | { spec: string }): R<string>;
  removePackage(id: string, name: string): R<string>;

  routines(id: string, signal?: AbortSignal): R<Routine[]>;
  saveRoutine(id: string, name: string, routine: { prompt: string; cron: string; enabled: boolean }): R<Routine>;
  deleteRoutine(id: string, name: string): R<null>;

  credentialSets(signal?: AbortSignal): R<CredentialSet[]>;
  credentials(id: string, signal?: AbortSignal): R<{ set: string; keys: string[] }[]>;
  saveCredentials(id: string, sets: string[]): R<{ set: string; keys: string[] }[]>;
  starters(signal?: AbortSignal): R<Starter[]>;

  tree(id: string, path: string, at?: string, signal?: AbortSignal): R<TreeEntry[]>;
  file(id: string, path: string, at?: string, signal?: AbortSignal): R<FileContent>;
  log(id: string, path: string, signal?: AbortSignal): R<Commit[]>;
  diff(id: string, commit: string, signal?: AbortSignal): R<string>;
  archiveUrl(id: string, path: string, at?: string): string;
}

export const AGENT_BUILDER_KEY = "agent-builder";
export type { AgentAvatar };
