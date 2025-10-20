// Install-prompt plumbing shared between PwaRegister (captures the event)
// and SettingsPanel (renders the "Install app" button).

export interface DeferredInstallPrompt {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: DeferredInstallPrompt | null = null;
let installedFlag = false;

export function captureInstallPrompt(): void {
  window.addEventListener(
    "beforeinstallprompt",
    (event: Event) => {
      event.preventDefault();
      deferred = event as unknown as DeferredInstallPrompt;
      window.dispatchEvent(new CustomEvent("drishti:installable"));
    },
    { once: true }
  );

  window.addEventListener("appinstalled", () => {
    installedFlag = true;
    deferred = null;
    window.dispatchEvent(new CustomEvent("drishti:installed"));
  });
}

export function canInstall(): boolean {
  return deferred !== null && !installedFlag;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  try {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") installedFlag = true;
    return choice.outcome;
  } catch (err) {
    // Some engines throw if the prompt is invoked twice or too late.
    console.warn("[drishti pwa] install prompt failed:", err);
    return "unavailable";
  } finally {
    deferred = null;
  }
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS / iPadOS Safari — never fires beforeinstallprompt, needs manual A2HS. */
export function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ masquerades as desktop Safari — detect via touch + Mac UA.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && "ontouchend" in document)
  );
}
