import { ids } from "../core/ids";
import type { Principal } from "../../shared/contracts/auth";
export const accounts = [
  {
    principal: {
      id: ids.user,
      displayName: "Minh Nguyễn",
      email: "user@vdaagent.test",
      role: "USER",
    } as Principal,
    password: "DemoUser!2026",
  },
] as const;
export const demoAdmin: Principal = {
  id: ids.admin,
  displayName: "Admin Demo",
  email: "admin@vdaagent.test",
  role: "ADMIN",
};
