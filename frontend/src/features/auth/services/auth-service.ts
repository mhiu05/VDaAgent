import type { AccountStatus, Session } from "../../../shared/contracts/auth";
import type { ServiceResult } from "../../../shared/contracts/service-result";
export interface DemoAccount {
  role: string;
  email: string;
  password: string;
}
export interface DemoOptions {
  available: DemoProfile[];
}
export type DemoProfile = "admin" | "vre-demo" | "alice";
export interface AuthService {
  restore(): Promise<ServiceResult<Session | null>>;
  login(email: string, password: string): Promise<ServiceResult<Session>>;
  demoOptions(): Promise<ServiceResult<DemoOptions>>;
  loginDemo(profile: DemoProfile): Promise<ServiceResult<Session>>;
  loginAdminDemo(): Promise<ServiceResult<Session>>;
  logout(): void;
  /** Invalidate the shell when the server revokes or expires the session. */
  onExpired?(listener: () => void): () => void;
  /** The account's current status without re-reading the rest of the session (`null` once the
   * session has ended); only the API implements it. */
  accountStatus?(): Promise<ServiceResult<AccountStatus | null>>;
  demoAccounts: readonly DemoAccount[];
}
