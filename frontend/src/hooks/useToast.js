import { useState } from "react";

export function useToast() {
  const [toast, setToast] = useState(null);

  function showToast(message, type = "info") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4200);
  }

  return { toast, showToast };
}
