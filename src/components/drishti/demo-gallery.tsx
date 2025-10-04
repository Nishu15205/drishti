"use client";

import { useState, useSyncExternalStore } from "react";
import { Camera, ChevronDown, Images } from "lucide-react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import { DEMO_PHOTOS, type DemoPhoto } from "@/lib/drishti/constants";

interface DemoGalleryProps {
  demo: DemoPhoto | null;
  onSelect: (photo: DemoPhoto | null) => void;
}

const NARROW_QUERY = "(max-width: 639px)";

function subscribeNarrow(callback: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function DemoGallery({ demo, onSelect }: DemoGalleryProps) {
  // Collapsed by default on phones (saves vertical space), open on desktop.
  // The user's manual toggle overrides the responsive default.
  const isNarrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  );
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? !isNarrow;

  const activeDemo = demo !== null;

  return (
    <Card className="border-neutral-800 bg-neutral-900/70">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
        aria-controls="demo-gallery-body"
        className="flex w-full items-center gap-2 px-6 py-4 text-left"
      >
        <Images className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-neutral-100">
            Demo photos
          </span>
          <span className="block truncate text-xs text-neutral-500">
            Live camera glitch ho to ye backup photos use karo
            {activeDemo && (
              <span className="ml-1.5 font-semibold text-amber-300">
                · {demo.label} chal raha hai
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`h-5 w-5 shrink-0 text-neutral-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div id="demo-gallery-body" className="min-w-0 px-6 pb-5">
          <div className="drishti-scroll flex min-w-0 gap-2.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-pressed={demo === null}
              aria-label="Use live camera"
              className={`flex h-[88px] w-[104px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                demo === null
                  ? "border-amber-400 bg-amber-400/10 text-amber-300"
                  : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600"
              }`}
            >
              <Camera className="h-6 w-6" aria-hidden />
              Live camera
            </button>

            {DEMO_PHOTOS.map((photo) => {
              const active = demo?.id === photo.id;
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onSelect(photo)}
                  aria-pressed={active}
                  aria-label={`Use demo photo: ${photo.label}`}
                  className={`group shrink-0 overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                    active
                      ? "border-amber-400 ring-2 ring-amber-400/60"
                      : "border-neutral-800 hover:border-neutral-600"
                  }`}
                >
                  <Image
                    src={photo.url}
                    alt={`Demo photo: ${photo.label}`}
                    width={104}
                    height={64}
                    className="h-16 w-[104px] object-cover"
                  />
                  <span
                    className={`block px-2 py-1.5 text-[11px] font-medium ${
                      active ? "bg-amber-400 text-black" : "bg-neutral-950 text-neutral-300"
                    }`}
                  >
                    {photo.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
