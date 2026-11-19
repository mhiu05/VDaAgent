import { createContext, useContext, type ReactNode } from "react";
import type { Services } from "../services/services";
const Context = createContext<Services | null>(null);
export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return <Context.Provider value={services}>{children}</Context.Provider>;
}
export function useServices() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing ServicesProvider");
  return value;
}
export function useWorkspaceService<T>(key: string): T {
  const service = useServices().workspace[key];
  if (!service) throw new Error(`Missing workspace service: ${key}`);
  return service as T;
}
