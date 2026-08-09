import { useState } from "react";

export function useAsyncTask(showToast) {
  const [loading, setLoading] = useState("");

  async function runTask(label, task, showLoader = true) {
    try {
      if (showLoader) setLoading(label);
      await task();
    } catch (error) {
      showToast(error.message, "critical");
    } finally {
      if (showLoader) setLoading("");
    }
  }

  return { loading, runTask };
}
