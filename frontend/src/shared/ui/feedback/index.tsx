import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Info } from "lucide-react";
export function InlineAlert({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "error";
}) {
  return (
    <div
      className={`inline-alert ${kind === "error" ? "error-alert" : ""}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Info size={18} />
      <div>{children}</div>
    </div>
  );
}
export function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="stack">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" style={{ width: "65%" }} />
    </div>
  );
}
type Feedback = {
  kind: "success" | "error" | "info";
  title: string;
  description?: string;
};
const FeedbackContext = createContext<(feedback: Feedback) => void>(() => {});
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <FeedbackContext.Provider value={setFeedback}>
      {children}
      {feedback && (
        <div className="toast" role="status">
          {feedback.title}
          {feedback.description && <p>{feedback.description}</p>}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}
export const useFeedback = () => useContext(FeedbackContext);
