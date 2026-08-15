export type NotebookCellKind = "markdown" | "prompt";
export type NotebookCellStatus = "draft" | "running" | "completed" | "failed";

export interface NotebookCell {
  id: string;
  notebook_id: string;
  position: number;
  kind: NotebookCellKind;
  title?: string | null;
  source: string;
  result?: { answer?: string; sources?: Array<Record<string, unknown>>; agent_run_id?: string | null; error?: string } | null;
  status: NotebookCellStatus | string;
  created_at?: string;
  updated_at?: string;
}

export interface Notebook {
  id: string;
  workspace_id: string;
  profile_run_id: string;
  title: string;
  description?: string | null;
  visibility: "private" | "workspace" | string;
  status: string;
  created_by_user_id: string;
  created_at?: string;
  updated_at?: string;
  cells?: NotebookCell[];
}
