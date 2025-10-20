"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Share2, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { canInstall, isIOS, isStandalone, promptInstall } from "@/lib/pwa-install";

const DISMISS_KEY = "drishti-install-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // quietly re-offer after a week

type BannerState = "hidden" | "native" | "manual";

/**
 * Inline "make it an app" banner.
 *
 * - Android/desktop Chrome: `beforeinstallprompt` fires → one-tap native
 *   install dialog.
 * - iOS Safari: the event never fires → show Add-to-Home-Screen steps.
 * - Hidden when already running standalone, or when dismissed within the
 *   last DISMISS_TTL_MS.
 *
 * Renders "hidden" on the server and decides only in effects — no hydration
 * mismatch, no layout flash of content that can't be shown.
 */
export function InstallBanner() {
  const [state, setState] = useState<BannerState>("hidden");

  const evaluate = useCallback(() => {
    if (isStandalone()) {
      setState("hidden");
      return;
    }
    try {
      const dismissedAt = Number(
        window.localStorage.getItem(DISMISS_KEY) ?? 0
      );
      if (Date.now() - dismissedAt < DISMISS_TTL_MS) {
        setState("hidden");
        return;
      }
    } catch {
      /* private mode — still offer */
    }
    if (canInstall()) setState("native");
    else if (isIOS()) setState("manual");
    else setState("hidden");
  }, []);

  useEffect(() => {
    // Evaluate off the effect body (deferred setState) and re-check shortly
    // after — the install event often arrives a beat past mount.
    const t1 = window.setTimeout(evaluate, 0);
    const t2 = window.setTimeout(evaluate, 1500);
    window.addEventListener("drishti:installable", evaluate);
    window.addEventListener("drishti:installed", evaluate);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("drishti:installable", evaluate);
      window.removeEventListener("drishti:installed", evaluate);
    };
  }, [evaluate]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* nothing to persist */
    }
    setState("hidden");
  }, []);

  const install = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.success("Drishti install ho gaya 🎉", {
        description: "Home screen icon se seedha kholo — full-screen app.",
      });
      setState("hidden");
    } else if (outcome === "dismissed") {
      // Prompt dismissed — don't nag again this session.
      setState("hidden");
    }
  }, []);

  if (state === "hidden") return null;

  return (
    <aside
      aria-label="Install Drishti app"
      className="relative rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/10 via-neutral-900 to-neutral-900 p-3.5 pr-10 sm:p-4 sm:pr-11"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Install banner hatao"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      {state === "native" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-black"
              aria-hidden
            >
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-neutral-100">
                Drishti ko phone me app banao
              </p>
              <p className="mt-0.5 text-xs leading-snug text-neutral-400">
                Home screen icon, full-screen camera, offline shell — 1 tap me.
              </p>
            </div>
          </div>
          <Button
            onClick={() => void install()}
            className="h-11 shrink-0 rounded-xl bg-amber-400 px-5 font-bold text-black hover:bg-amber-300 sm:ml-auto"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden />
            Install app
          </Button>
        </div>
      ) : (
        <IosInstallSteps />
      )}
    </aside>
  );
}

/** Manual Add-to-Home-Screen walkthrough for iOS Safari. */
export function IosInstallSteps() {
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-black"
        aria-hidden
      >
        <Smartphone className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-neutral-100">
          iPhone par Drishti app banao
        </p>
        <ol className="mt-1.5 list-none space-y-1 text-xs leading-snug text-neutral-400">
          <li className="flex items-center gap-1.5">
            <Share2 className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <span>
              Safari me <Share2 className="inline h-3 w-3 text-amber-300" aria-hidden />{" "}
              <b className="text-neutral-200">Share</b> dabao
            </span>
          </li>
          <li>
            <b className="text-neutral-200">Add to Home Screen</b> choose karo
          </li>
          <li>
            Icon tap karo — <b className="text-amber-300">full-screen app</b> ready
          </li>
        </ol>
      </div>
    </div>
  );
}
