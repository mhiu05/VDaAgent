"use client";

import { DatasourceConnector } from "@/components/datasource-connector";
import type { DatasourceKind } from "@/lib/types";

/** Connector-center entry point. DatasourceConnector remains the compatibility
 * implementation used by /datasets/new. */
export function ConnectionWizard({ kind = "mongodb", onSaved }: {
  kind?: DatasourceKind;
  onSaved?: () => void;
}) {
  return <DatasourceConnector initialKind={kind} saveOnly onSaved={onSaved} />;
}
