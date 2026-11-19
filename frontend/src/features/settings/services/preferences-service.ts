import type { Preferences } from "../../../shared/contracts/preferences";
import type { ServiceResult } from "../../../shared/contracts/service-result";
export interface PreferencesService {
  load(principalId: string, displayName: string): Preferences;
  save(
    principalId: string,
    value: Preferences,
  ): Promise<ServiceResult<Preferences>>;
  readonly degraded: boolean;
}
