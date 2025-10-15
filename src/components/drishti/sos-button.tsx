"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Phone,
  Send,
  Settings2,
  Siren,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { beep } from "@/lib/drishti/media";

interface SosContact {
  name: string;
  phone: string;
}

const CONTACTS_KEY = "drishti-sos-contacts";
const HOLD_MS = 1200;
const MAX_CONTACTS = 5;

function loadContacts(): SosContact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is SosContact =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as SosContact).name === "string" &&
          typeof (c as SosContact).phone === "string"
      )
      .slice(0, MAX_CONTACTS);
  } catch {
    return [];
  }
}

/**
 * Emergency SOS: hold the red button 1.2s → full-screen emergency mode with
 * siren, GPS location and one-tap WhatsApp / Call alerts to saved contacts
 * (wa.me deep links — zero backend, zero cost, works on any phone).
 */
export function SosButton() {
  const [phase, setPhase] = useState<"idle" | "arming" | "active">("idle");
  const [view, setView] = useState<"alert" | "contacts">("alert");
  const [contacts, setContacts] = useState<SosContact[]>([]);
  const [loc, setLoc] = useState<{
    lat: number;
    lng: number;
    acc: number;
  } | null>(null);
  const [locState, setLocState] = useState<"waiting" | "ok" | "failed">(
    "waiting"
  );
  const [sirenOn, setSirenOn] = useState(true);
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sirenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copiedRef = useRef(false);

  const stopSiren = useCallback(() => {
    if (sirenTimerRef.current) {
      clearInterval(sirenTimerRef.current);
      sirenTimerRef.current = null;
    }
    setSirenOn(false);
  }, []);

  const startSiren = useCallback(() => {
    if (sirenTimerRef.current) return;
    setSirenOn(true);
    const pattern = () => {
      beep(1250, 160);
      setTimeout(() => beep(880, 160), 210);
    };
    pattern();
    sirenTimerRef.current = setInterval(pattern, 1500);
  }, []);

  const openOverlay = useCallback(() => {
    copiedRef.current = false;
    setContacts(loadContacts());
    setView("alert");
    setLoc(null);
    setLocState("waiting");
    setPhase("active");
    try {
      navigator.vibrate?.([300, 120, 300]);
    } catch {
      /* vibration is best-effort */
    }
    startSiren();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLoc({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: Math.round(pos.coords.accuracy),
          });
          setLocState("ok");
        },
        () => setLocState("failed"),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
      );
    } else {
      setLocState("failed");
    }
  }, [startSiren]);

  const closeOverlay = useCallback(() => {
    setPhase("idle");
    stopSiren();
  }, [stopSiren]);

  const startHold = useCallback(() => {
    if (phase === "active") return;
    setPhase("arming");
    beep(600, 80);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      openOverlay();
    }, HOLD_MS);
  }, [phase, openOverlay]);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (phase === "arming") setPhase("idle");
    }
  }, [phase]);

  // Escape closes the overlay
  useEffect(() => {
    if (phase !== "active") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, closeOverlay]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (sirenTimerRef.current) clearInterval(sirenTimerRef.current);
    };
  }, []);

  const message = useMemo(() => {
    const where = loc
      ? `Location: https://maps.google.com/?q=${loc.lat},${loc.lng} (±${loc.acc}m)`
      : "Location abhi nahi mil payi — turant call karo.";
    return `🚨 EMERGENCY! Mujhe madad chahiye. ${where} — Drishti app se bheja gaya.`;
  }, [loc]);

  // Auto-copy the alert message once location settles (or fails)
  useEffect(() => {
    if (phase !== "active" || locState === "waiting" || copiedRef.current)
      return;
    copiedRef.current = true;
    try {
      navigator.clipboard?.writeText(message).catch(() => {});
    } catch {
      /* clipboard is best-effort */
    }
  }, [phase, locState, message]);

  const addContact = () => {
    const name = cName.trim();
    const digits = cPhone.replace(/\D/g, "");
    if (!name || digits.length < 8) {
      toast.warning("Naam aur sahi number likho", {
        description: "Country code ke saath — jaise 919876543210",
      });
      return;
    }
    const next = [...contacts, { name, phone: cPhone.trim() }].slice(
      0,
      MAX_CONTACTS
    );
    setContacts(next);
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    setCName("");
    setCPhone("");
    toast.success(`${name} emergency contacts me add ho gaya`);
  };

  const removeContact = (idx: number) => {
    const next = contacts.filter((_, i) => i !== idx);
    setContacts(next);
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Message copy ho gaya");
    } catch {
      toast.error("Copy nahi hua");
    }
  };

  const holdButton = (
    <button
      type="button"
      aria-label="Emergency SOS — 1.2 second tak daba ke rakho"
      onPointerDown={(e) => {
        e.preventDefault();
        startHold();
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed bottom-24 right-4 z-50 flex h-16 w-16 touch-none select-none flex-col items-center justify-center rounded-full border-2 border-red-400/70 bg-red-600 text-white shadow-xl shadow-red-600/40 transition-all hover:bg-red-500 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      {phase === "arming" && (
        <span
          className="absolute inset-0 animate-ping rounded-full bg-red-500/70"
          aria-hidden
        />
      )}
      <Siren className="h-7 w-7" aria-hidden />
      <span className="text-[10px] font-black tracking-widest">SOS</span>
    </button>
  );

  if (phase !== "active") return holdButton;

  return (
    <>
      {holdButton}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Emergency mode"
        className="fixed inset-0 z-[100] overflow-y-auto bg-red-950/95 backdrop-blur-sm"
      >
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 p-5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Siren
              className="h-9 w-9 animate-pulse text-red-400"
              aria-hidden
            />
            <div>
              <h2 className="text-2xl font-black tracking-tight text-red-100">
                EMERGENCY
              </h2>
              <p className="text-xs text-red-300/80">
                Drishti SOS — madad ke liye niche tap karo
              </p>
            </div>
            <span
              className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                sirenOn
                  ? "animate-pulse bg-red-500 text-white"
                  : "bg-neutral-800 text-neutral-400"
              }`}
            >
              {sirenOn ? "Siren ON" : "Siren off"}
            </span>
          </div>

          {/* Location status */}
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
              locState === "ok"
                ? "border-green-700/60 bg-green-950/40 text-green-200"
                : locState === "waiting"
                  ? "border-amber-700/60 bg-amber-950/30 text-amber-200"
                  : "border-neutral-700 bg-black/30 text-neutral-400"
            }`}
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            {locState === "ok"
              ? `Location mil gayi (±${loc?.acc}m) — message me map link hai`
              : locState === "waiting"
                ? "Location aa rahi hai…"
                : "Location nahi mili — message me map link nahi hoga"}
          </div>

          {view === "alert" ? (
            <>
              {/* Message preview + copy */}
              <div className="rounded-xl border border-red-900/60 bg-black/40 p-3">
                <p className="break-words text-xs leading-relaxed text-red-100">
                  {message}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyMessage()}
                  className="mt-2 h-9 border-red-800 bg-transparent text-red-200 hover:bg-red-500/10"
                >
                  Message copy karo
                </Button>
              </div>

              {/* Contact actions */}
              {contacts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-red-800 p-4 text-center">
                  <p className="text-sm text-red-200">
                    Koi emergency contact nahi hai. Pehle contacts add karo —
                    phir ek tap me WhatsApp alert jayega.
                  </p>
                  <Button
                    type="button"
                    onClick={() => setView("contacts")}
                    className="mt-3 bg-red-600 font-bold text-white hover:bg-red-500"
                  >
                    <Settings2 className="mr-2 h-4 w-4" aria-hidden />
                    Contacts set karo
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {contacts.map((c, i) => (
                    <div
                      key={`${c.phone}-${i}`}
                      className="rounded-xl border border-red-900/60 bg-black/40 p-3"
                    >
                      <p className="font-bold text-red-50">{c.name}</p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <a
                          href={`https://wa.me/${c.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 text-sm font-bold text-white transition hover:bg-green-500"
                        >
                          <Send className="h-4 w-4" aria-hidden />
                          WhatsApp
                        </a>
                        <a
                          href={`tel:${c.phone}`}
                          className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-800 bg-transparent px-3 text-sm font-bold text-red-100 transition hover:bg-red-500/10"
                        >
                          <Phone className="h-4 w-4" aria-hidden />
                          Call
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Contacts editor */}
              <div className="space-y-2">
                <Input
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  placeholder="Naam — jaise Pappa"
                  maxLength={40}
                  className="h-11 border-red-900/60 bg-black/40 text-red-50 placeholder:text-red-300/40"
                  aria-label="Contact name"
                />
                <Input
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                  placeholder="Number (country code) — 919876543210"
                  inputMode="tel"
                  maxLength={20}
                  className="h-11 border-red-900/60 bg-black/40 text-red-50 placeholder:text-red-300/40"
                  aria-label="Contact phone number"
                />
                <Button
                  type="button"
                  onClick={addContact}
                  className="h-11 w-full bg-red-600 font-bold text-white hover:bg-red-500"
                >
                  Contact add karo
                </Button>
                <p className="text-xs text-red-300/70">
                  WhatsApp alerts ke liye number country code ke saath likho
                  (India: 91…). Max {MAX_CONTACTS} contacts.
                </p>
              </div>

              {contacts.length > 0 && (
                <div className="space-y-2">
                  {contacts.map((c, i) => (
                    <div
                      key={`${c.phone}-${i}`}
                      className="flex items-center gap-3 rounded-xl border border-red-900/60 bg-black/40 p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-red-50">
                          {c.name}
                        </p>
                        <p className="truncate text-xs text-red-300/70">
                          {c.phone}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${c.name}`}
                        onClick={() => removeContact(i)}
                        className="h-9 w-9 shrink-0 text-red-300/70 hover:bg-red-500/10 hover:text-red-200"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setView("alert")}
                className="h-11 border-red-800 bg-transparent text-red-100 hover:bg-red-500/10"
              >
                Wapas emergency screen par
              </Button>
            </>
          )}

          {/* Footer controls */}
          <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => (sirenOn ? stopSiren() : startSiren())}
              className="h-12 border-red-800 bg-transparent text-red-100 hover:bg-red-500/10"
            >
              {sirenOn ? (
                <VolumeX className="mr-2 h-4 w-4" aria-hidden />
              ) : (
                <Volume2 className="mr-2 h-4 w-4" aria-hidden />
              )}
              {sirenOn ? "Siren band" : "Siren chalu"}
            </Button>
            <Button
              type="button"
              onClick={closeOverlay}
              className="h-12 bg-neutral-200 font-bold text-neutral-900 hover:bg-white"
            >
              <Square className="mr-2 h-4 w-4" aria-hidden />
              Sab band karo
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
