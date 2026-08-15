import { useState } from "react";

export function useAsyncTask(showToast) {
  const [loading, setLoading] = useState("");

  async function runTask(label, task, showLoader = true) {
    try {
      if (showLoader) setLoading(label);
      await task();
    } catch (error) {
      console.error(`[${label}]`, error);
      showToast(error?.message || "Request failed. Check that the backend is running and try again.", "critical");
    } finally {
      if (showLoader) setLoading("");
    }
  }

  return { loading, runTask };
}
