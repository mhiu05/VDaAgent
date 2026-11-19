import { lazy } from "react";
import { useLocation } from "react-router";
import { useServices } from "../../../app/providers/ServicesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import { ProvisioningState } from "../components/ProvisioningState";
import { AGENT_CHAT_KEY } from "../services/agent-chat-service";

const AgentChatPage = lazy(() => import("./AgentChatPage"));
const MockChatPage = lazy(() => import("./ChatPage"));
const BrowserFilePreviewPage = lazy(() => import("./BrowserFilePreviewPage"));

/** `/chat` shows the target chat when the `agent-chat` port is configured (hybrid/api mode);
 * mock mode keeps the scripted chat (decision 0022). While the account is still provisioning, or
 * its provisioning failed, a status screen stands in for the (still empty) chat.
 * `/chat/file-preview` is the browser pop-out for an attachment. */
export default function ChatRoute() {
  // every hook runs before any early return (stable hook order)
  const location = useLocation();
  const configured = Boolean(useServices().workspace[AGENT_CHAT_KEY]);
  const { snapshot } = useAuth();
  if (location.pathname === "/chat/file-preview") return <BrowserFilePreviewPage />;
  const account = snapshot.status === "authenticated" ? snapshot.accountStatus : undefined;
  if (configured && (account === "provisioning" || account === "failed")) {
    return <ProvisioningState status={account} />;
  }
  return configured ? <AgentChatPage /> : <MockChatPage />;
}
