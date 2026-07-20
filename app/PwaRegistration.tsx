"use client";

import { useEffect } from "react";

export type ServiceWorkerRegistrationSchedule = {
  readyState: DocumentReadyState;
  addLoadListener: (listener: () => void) => void;
  removeLoadListener: (listener: () => void) => void;
  register: () => Promise<unknown>;
};

export function scheduleServiceWorkerRegistration({
  readyState,
  addLoadListener,
  removeLoadListener,
  register,
}: ServiceWorkerRegistrationSchedule): () => void {
  let active = true;
  const run = () => {
    if (!active) return;
    void register().catch(() => undefined);
  };

  if (readyState === "complete") {
    run();
  } else {
    addLoadListener(run);
  }

  return () => {
    active = false;
    removeLoadListener(run);
  };
}

export default function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    return scheduleServiceWorkerRegistration({
      readyState: document.readyState,
      addLoadListener: (listener) => window.addEventListener("load", listener, { once: true }),
      removeLoadListener: (listener) => window.removeEventListener("load", listener),
      register: () => navigator.serviceWorker.register("/service-worker.js", { scope: "/" }),
    });
  }, []);

  return null;
}
