"use client";

import { format } from "date-fns";
import { History, Mic, ScanEye, Trash2, Volume2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { HistoryItem } from "@/hooks/use-drishti";

const MODE_LABEL: Record<string, string> = {
  scene: "Scene",
  currency: "Currency",
  medicine: "Medicine",
  text: "Text",
  ask: "Voice Q&A",
};

interface InsightFeedProps {
  feed: HistoryItem[];
  onReplay: (item: HistoryItem) => void;
  onClear: () => void;
}

export function InsightFeed({ feed, onReplay, onClear }: InsightFeedProps) {
  return (
    <Card className="flex h-full flex-col border-neutral-800 bg-neutral-900/70 shadow-2xl shadow-black/40">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-neutral-100">
          <History className="h-5 w-5 text-amber-400" aria-hidden />
          Insights
          <Badge
            variant="secondary"
            className="bg-amber-400/15 text-xs text-amber-300"
          >
            {feed.length}
          </Badge>
        </CardTitle>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear all insights"
              disabled={!feed.length}
              className="h-9 w-9 text-neutral-400 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all insights?</AlertDialogTitle>
              <AlertDialogDescription className="text-neutral-400">
                Saari history delete ho jayegi. Ye wapas nahi aayegi.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-neutral-700 bg-transparent text-neutral-200 hover:bg-neutral-800">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onClear}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                Clear
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>

      <div
        aria-hidden
        className="h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"
      />

      <CardContent className="min-h-0 flex-1 pb-4">
        {feed.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-400/20 bg-amber-400/[0.03] text-center">
            <ScanEye className="h-8 w-8 animate-pulse text-amber-400/40" aria-hidden />
            <p className="px-6 text-sm text-neutral-500">
              Abhi koi insight nahi.
              <br />
              Bol &ldquo;scan&rdquo; ya button dabao — Drishti bol kar batayega.
            </p>
          </div>
        ) : (
          <ScrollArea className="drishti-scroll h-[min(430px,52vh)] min-h-[220px] pr-2 lg:h-[430px]">
            <ul className="space-y-3" aria-label="Insight history">
              {feed.map((item) => (
                <li
                  key={item.id}
                  className={`rounded-xl border border-neutral-800 border-l-2 bg-neutral-950/60 p-3 ${
                    item.kind === "ask"
                      ? "border-l-rose-400/80"
                      : "border-l-amber-400/80"
                  }`}
                >
                  <div className="flex gap-3">
                    {item.thumb ? (
                      <img
                        src={item.thumb}
                        alt="Snapshot of the analysed scene"
                        className="h-14 w-20 shrink-0 rounded-lg border border-neutral-800 object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900">
                        <ScanEye className="h-5 w-5 text-neutral-600" aria-hidden />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                        {item.kind === "ask" ? (
                          <Mic className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                        ) : (
                          <ScanEye className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                        )}
                        <span className="font-semibold uppercase tracking-wider">
                          {MODE_LABEL[item.mode] ?? item.mode}
                        </span>
                        {item.source.startsWith("demo:") && (
                          <Badge
                            variant="outline"
                            className="border-amber-400/40 px-1.5 py-0 text-[9px] uppercase text-amber-300"
                          >
                            demo
                          </Badge>
                        )}
                        <span aria-hidden>·</span>
                        <time dateTime={item.createdAt}>
                          {format(new Date(item.createdAt), "h:mm a")}
                        </time>
                      </div>

                      {item.question && (
                        <p className="mt-1 truncate text-sm font-medium text-amber-300">
                          &ldquo;{item.question}&rdquo;
                        </p>
                      )}
                      <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-neutral-200">
                        {item.answer}
                      </p>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onReplay(item)}
                        aria-label="Listen to this insight again"
                        className="mt-1.5 h-8 px-2 text-xs text-neutral-400 hover:bg-amber-400/10 hover:text-amber-300"
                      >
                        <Volume2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Phir se suno
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
