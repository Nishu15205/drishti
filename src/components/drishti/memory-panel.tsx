"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CapturedFrame } from "@/lib/drishti/media";

export type MemoryKind = "face" | "item";

interface MemoryItem {
  id: string;
  kind: string;
  name: string;
  note: string | null;
  image: string;
  createdAt: string;
}

const COPY: Record<
  MemoryKind,
  {
    title: string;
    desc: string;
    namePh: string;
    notePh: string;
    save: string;
    empty: string;
  }
> = {
  face: {
    title: "Pehchaan — Apne log",
    desc: "Apno ki photo + naam save karo. Scan karte hi app bolega kaun saamne khada hai.",
    namePh: "Naam — jaise Mummy, Rahul bhaiya",
    notePh: "Rishta (optional) — jaise ghar wale, classmate",
    save: "Pehchaan save karo",
    empty: "Abhi koi apna save nahi hai — pehla chehra add karo.",
  },
  item: {
    title: "Yaad — Meri cheezein",
    desc: "Apni cheez ki photo + naam save karo. Baad me poochho — \u201cmeri chabi kahan hai?\u201d",
    namePh: "Cheez ka naam — jaise Chabi, Bag",
    notePh: "Note (optional) — jaise study table ke pass",
    save: "Cheez save karo",
    empty: "Abhi koi cheez save nahi hai — pehli cheez add karo.",
  },
};

interface MemoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: MemoryKind;
  onCapture: () => Promise<CapturedFrame | null>;
}

export function MemoryPanel({
  open,
  onOpenChange,
  kind,
  onCapture,
}: MemoryPanelProps) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const copy = COPY[kind];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memories");
      const data = (await res.json()) as { items?: MemoryItem[] };
      setItems((data.items ?? []).filter((i) => i.kind === kind));
    } catch {
      /* list is non-critical */
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setName("");
      setNote("");
      setPreview(null);
      await load();
    })();
  }, [open, load]);

  const handleCapture = async () => {
    setCapturing(true);
    try {
      const frame = await onCapture();
      if (!frame) {
        toast.error("Frame nahi mila", {
          description: "Camera check karo ya dobara try karo.",
        });
        return;
      }
      setPreview(frame.image);
    } finally {
      setCapturing(false);
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.warning("Naam likho");
      return;
    }
    if (!preview) {
      toast.warning("Pehle photo lo");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: trimmed,
          note: note.trim() || null,
          image: preview,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Save failed");
      }
      toast.success(`"${trimmed}" save ho gaya — ab scan karke poochho!`);
      setName("");
      setNote("");
      setPreview(null);
      await load();
    } catch (err) {
      toast.error("Save nahi hua", {
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/memories?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Hata diya");
    } catch {
      toast.error("Delete nahi hua");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-neutral-900 text-neutral-100">
        <DialogHeader>
          <DialogTitle className="text-lg">{copy.title}</DialogTitle>
          <DialogDescription className="text-sm text-neutral-400">
            {copy.desc}
          </DialogDescription>
        </DialogHeader>

        {/* Register form */}
        <div className="space-y-3">
          <div className="relative h-40 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950">
            {preview ? (
              <img
                src={preview}
                alt="Saved memory preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Photo lo — yahan preview dikhega
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              disabled={capturing}
              onClick={() => void handleCapture()}
              className="h-11 border-neutral-700 bg-neutral-800 hover:bg-neutral-700"
            >
              {capturing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Camera className="mr-2 h-4 w-4" aria-hidden />
              )}
              Photo lo
            </Button>
            <Button
              type="button"
              disabled={saving || !preview}
              onClick={() => void handleSave()}
              className="h-11 bg-amber-400 font-bold text-black hover:bg-amber-300 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" aria-hidden />
              )}
              {copy.save}
            </Button>
          </div>

          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={copy.namePh}
            maxLength={60}
            className="h-11 border-neutral-700 bg-neutral-950"
            aria-label="Name"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={copy.notePh}
            maxLength={120}
            className="h-11 border-neutral-700 bg-neutral-950"
            aria-label="Note (optional)"
          />
        </div>

        {/* Saved list */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
            Saved ({items.length})
          </p>
          <div className="scrollbar-thin max-h-56 space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-neutral-500">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              </div>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-800 px-3 py-4 text-center text-sm text-neutral-500">
                {copy.empty}
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-2"
                >
                  <img
                    src={item.image}
                    alt={`Saved: ${item.name}`}
                    className="h-11 w-11 shrink-0 rounded-md border border-neutral-800 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    {item.note && (
                      <p className="truncate text-xs text-neutral-500">
                        {item.note}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => void handleDelete(item.id)}
                    className="h-9 w-9 shrink-0 text-neutral-500 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
