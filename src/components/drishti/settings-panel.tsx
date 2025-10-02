"use client";

import { useEffect, useState } from "react";
import {
  Download,
  Keyboard,
  Mic,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LANGS, type Lang } from "@/lib/drishti/constants";
import {
  canInstall,
  isIOS,
  isStandalone,
  promptInstall,
} from "@/lib/pwa-install";
import { IosInstallSteps } from "@/components/pwa/install-banner";
import type { VoiceCommandState } from "@/hooks/use-voice-commands";

interface SettingsPanelProps {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  speechSupported: boolean;
  voiceCmdsOn: boolean;
  onVoiceCmdsChange: (on: boolean) => void;
  voiceCommandState: VoiceCommandState;
}

export function SettingsPanel({
  lang,
  onLangChange,
  speed,
  onSpeedChange,
  speechSupported,
  voiceCmdsOn,
  onVoiceCmdsChange,
  voiceCommandState,
}: SettingsPanelProps) {
  const [installable, setInstallable] = useState(false);
  const [iosManual, setIosManual] = useState(false);

  // Reflect the browser's install prompt availability
  useEffect(() => {
    const check = () => {
      const standalone = isStandalone();
      setInstallable(canInstall() && !standalone);
      setIosManual(!canInstall() && !standalone && isIOS());
    };
    check();
    window.addEventListener("drishti:installable", check);
    window.addEventListener("drishti:installed", check);
    return () => {
      window.removeEventListener("drishti:installable", check);
      window.removeEventListener("drishti:installed", check);
    };
  }, []);

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.success("Drishti install ho gaya", {
        description: "Home screen se seedha kholo — mic hamesha ready rahega.",
      });
      setInstallable(false);
    } else if (outcome === "dismissed") {
      toast.info("Install cancel ho gaya", {
        description: "Settings se dobara try kar sakte ho.",
      });
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Open Drishti settings"
          className="h-10 w-10 border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
        >
          <Settings2 className="h-5 w-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[320px] overflow-y-auto border-neutral-800 bg-neutral-950 text-neutral-100 sm:w-[360px]"
      >
        <SheetHeader>
          <SheetTitle className="text-lg font-bold">Settings</SheetTitle>
          <SheetDescription className="text-sm text-neutral-400">
            Voice aur language tuning karo
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 space-y-6 px-4 pb-8">
          {/* Always-on voice commands */}
          <section aria-label="Voice commands">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                <Mic className="h-3.5 w-3.5" aria-hidden />
                Voice command
              </h3>
              <Switch
                checked={voiceCmdsOn}
                onCheckedChange={onVoiceCmdsChange}
                aria-label="Always-on voice command microphone"
                className="data-[state=checked]:bg-amber-400 data-[state=unchecked]:bg-neutral-700"
              />
            </div>
            <p className="mt-2 text-[11px] leading-snug text-neutral-500">
              Mic hamesha on rehta hai. Bas{" "}
              <span className="font-bold text-amber-300">&ldquo;scan&rdquo;</span>{" "}
              bolo — Drishti khud scan karke bata dega. {lang === "hi" ? "“स्कैन” भी चलेगा।" : "Hands-free."}
            </p>
            {voiceCmdsOn && voiceCommandState === "denied" && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[11px] text-red-300">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Mic permission block hai. Address bar / browser settings se
                  microphone allow karo, phir screen kahin tap karo.
                </span>
              </div>
            )}
            {voiceCmdsOn && voiceCommandState === "unsupported" && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-2.5 text-[11px] text-neutral-400">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Ye browser voice commands support nahi karta — Chrome ya Edge
                  try karo. Buttons abhi bhi kaam karte hain.
                </span>
              </div>
            )}
          </section>

          {/* Language */}
          <section aria-label="Voice language">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Bhasha / Language
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={lang === l.id}
                  onClick={() => onLangChange(l.id)}
                  className={`rounded-xl border px-3 py-4 text-center font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                    lang === l.id
                      ? "border-amber-400 bg-amber-400 text-black"
                      : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                  }`}
                >
                  <span className="block text-base">{l.label}</span>
                  <span
                    className={`mt-0.5 block text-[10px] uppercase tracking-widest ${
                      lang === l.id ? "text-black/60" : "text-neutral-500"
                    }`}
                  >
                    {l.id === "en" ? "cloud voice" : "हिंदी API · शुद्ध"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Speech speed */}
          <section aria-label="Speech speed">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                Voice speed
              </h3>
              <span className="rounded-md bg-neutral-900 px-2 py-0.5 text-sm font-bold text-amber-300">
                {speed.toFixed(2)}×
              </span>
            </div>
            <Slider
              value={[speed]}
              min={0.5}
              max={2}
              step={0.25}
              onValueChange={(values) => onSpeedChange(values[0] ?? 1)}
              aria-label="Speech speed"
              className="[&_[data-slot=slider-range]]:bg-amber-400"
            />
            <div className="mt-1.5 flex justify-between text-[10px] text-neutral-600">
              <span>0.5× dheere</span>
              <span>2× tez</span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-neutral-500">
              Speed har bhasha ke liye alag set hoti hai — English dheemi,
              हिंदी tez.
            </p>
          </section>

          {/* Install as app */}
          {installable && (
            <section aria-label="Install app">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                App
              </h3>
              <Button
                onClick={() => void handleInstall()}
                className="h-12 w-full rounded-xl bg-amber-400 font-bold text-black hover:bg-amber-300"
              >
                <Download className="mr-2 h-5 w-5" aria-hidden />
                Drishti install karo (PWA)
              </Button>
              <p className="mt-2 text-[11px] leading-snug text-neutral-500">
                Home screen par icon aa jayega — full screen, jaise real app.
              </p>
            </section>
          )}

          {/* iOS Safari never fires beforeinstallprompt — manual A2HS steps */}
          {iosManual && (
            <section aria-label="Install app on iPhone">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                App
              </h3>
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
                <IosInstallSteps />
              </div>
            </section>
          )}

          {/* Keyboard shortcuts */}
          <section aria-label="Keyboard shortcuts">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
              Shortcuts
            </h3>
            <ul className="space-y-2 text-sm text-neutral-300">
              <li className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                <span>Aas-paas batao</span>
                <kbd className="rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs font-bold text-amber-300">
                  Space
                </kbd>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                <span>Mic pakdo (hold)</span>
                <kbd className="rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-xs font-bold text-amber-300">
                  Hold M
                </kbd>
              </li>
              <li className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2">
                <span>Ya bas bolo</span>
                <span className="text-xs font-bold text-amber-300">
                  &ldquo;Scan&rdquo;
                </span>
              </li>
            </ul>
          </section>

          {!speechSupported && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Voice output is not working in this browser session. Insights
                abhi bhi text feed mein dikh rahe hain.
              </span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
