"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "@/lib/pwa-install";

const RELOAD_KEY = "drishti-sw-reload-at";

/** Rate-limited one-shot reload guard — never loops. */
function shouldReloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * Registers the Drishti service worker once on mount and captures the
 * browser's install prompt so the settings panel can offer "Install app".
 *
 * When a freshly installed service worker takes control of a page that was
 * already controlled (an update), the page reloads exactly once so every
 * chunk hydrates from the same code generation — stale-JS hydration bugs
 * heal themselves without any manual hard-refresh.
 */
export function PwaRegister() {
  useEffect(() => {
    captureInstallPrompt();

    if (!("serviceWorker" in navigator)) return;

    // True only when this page load was already served by an older worker —
    // i.e. controllerchange can only mean "an update took over".
    const hadController = !!navigator.serviceWorker.controller;
    let reloadDone = false;

    const onControllerChange = () => {
      if (!hadController || reloadDone) return;
      if (!shouldReloadForUpdate()) return;
      reloadDone = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Check for updates when the tab regains focus
          reg.addEventListener("updatefound", () => {
            console.log("[drishti pwa] new service worker installing…");
          });
        })
        .catch((err) => {
          console.warn("[drishti pwa] service worker registration failed:", err);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, []);

  return null;
}
