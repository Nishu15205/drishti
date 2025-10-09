// Server-side Devanagari → English-TTS-friendly romanization.
//
// WHY THIS EXISTS: the cloud TTS voices are Chinese/English — when given
// Devanagari they garble it into Chinese-sounding syllables (verified by
// ASR round-trip: jam said "tian tian tian", kazi/douji produced literal
// Chinese transcriptions). Fed romanized Hindi, the same voices speak
// intelligible Hindi. The VLM keeps answering in pure Devanagari (nice
// display cards), and every TTS call romanizes its chunk just before
// synthesis, so the user always hears real Hindi words, never Chinese.

const CONS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "ny",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", श: "sh", ष: "sh", स: "s", ह: "h",
  ळ: "l",
};

// Base consonant + nukta (ज़ ड़ फ़ …) — applied when ़ follows the letter
const NUKTA: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", ज: "z", ड: "r", ढ: "rh", फ: "f", य: "y",
};

const VOWEL_SIGN: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
};

const INDEP_VOWEL: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo",
  ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au",
};

const DEV_DIGITS = "०१२३४५६७८९";

interface Syl {
  cons: string; // consonant cluster ("", "k", "chh", "y" glide…)
  vowel: string | null; // "a" inherent, matra value, "" deleted, null = closed
  nasal: string; // "n" (anusvara/chandrabindu) or "ah" (visarga)
}

/**
 * Convert Devanagari (or mixed) text into romanized Hindi that English
 * TTS voices pronounce correctly. Latin text passes through unchanged.
 */
export function devanagariToRoman(input: string): string {
  const out: (Syl | string)[] = [];
  let pending: Syl | null = null;
  let pendingChar = "";
  const flush = () => {
    if (pending) {
      out.push(pending);
      pending = null;
      pendingChar = "";
    }
  };

  for (const ch of Array.from(input)) {
    if (CONS[ch]) {
      flush();
      pending = { cons: CONS[ch], vowel: "a", nasal: "" };
      pendingChar = ch;
      continue;
    }
    if (ch === "़") {
      // nukta modifies the preceding consonant (ज़→z, फ़→f, ड़→r …)
      if (pending && NUKTA[pendingChar]) pending.cons = NUKTA[pendingChar];
      continue;
    }
    if (ch === "्") {
      if (pending) pending.vowel = null; // virama: close the cluster
      continue;
    }
    if (VOWEL_SIGN[ch]) {
      if (pending) pending.vowel = VOWEL_SIGN[ch];
      else out.push(VOWEL_SIGN[ch]);
      continue;
    }
    if (ch === "ं" || ch === "ँ") {
      if (pending) pending.nasal = "n";
      else out.push("n");
      continue;
    }
    if (ch === "ः") {
      if (pending) pending.nasal = "ah";
      else out.push("ah");
      continue;
    }
    if (INDEP_VOWEL[ch]) {
      flush();
      // vowel right after a vowel-bearing syllable takes a glide:
      // दाईं→daayeen, गई→gayee, जाऊँ→jaawoon
      const prev = out[out.length - 1];
      let cons = "";
      if (prev && typeof prev !== "string" && prev.vowel) {
        if ("ईइएऐ".includes(ch)) cons = "y";
        else if ("ऊउओऔ".includes(ch)) cons = "w";
      }
      out.push({ cons, vowel: INDEP_VOWEL[ch], nasal: "" });
      continue;
    }
    const di = DEV_DIGITS.indexOf(ch);
    if (di >= 0) {
      flush();
      out.push(String(di));
      continue;
    }
    if (ch === "।" || ch === "॥") {
      flush();
      out.push(". ");
      continue;
    }
    // space / punctuation / Latin text — ends the current word
    flush();
    out.push(ch);
  }
  flush();

  // ---- schwa deletion (right-to-left, per word) ----
  // • word-final inherent 'a' always drops            (मेज़ → mez)
  // • a medial inherent 'a' drops only when the word has ≥3 vowel-bearing
  //   syllables, the syllable is not word-initial, and the next syllable
  //   is open with a vowel other than 'a':
  //     आपके→aapke ✓   करना→karnaa ✓   दरवाज़ा→darvaazaa ✓   पहले→pahle ✓
  //     while नहीं→naheen, कभी→kabhee, नमस्ते→namaste stay intact ✓
  for (let i = out.length - 1; i >= 0; i--) {
    const cur = out[i];
    if (typeof cur === "string" || cur.vowel !== "a") continue;

    const next = out[i + 1];
    if (next === undefined || typeof next === "string") {
      cur.vowel = ""; // word-final
      continue;
    }
    let start = i;
    while (start > 0 && typeof out[start - 1] !== "string") start--;
    let end = i;
    while (end + 1 < out.length && typeof out[end + 1] !== "string") end++;
    const wordSyls = out.slice(start, end + 1) as Syl[];
    const vowelBearing = wordSyls.filter((s) => s.vowel && s.vowel !== "").length;
    const nextOpen = (next as Syl).vowel !== null && (next as Syl).vowel !== "";
    if (vowelBearing >= 3 && i !== start && nextOpen && (next as Syl).vowel !== "a") {
      cur.vowel = "";
    }
  }

  let result = "";
  for (const piece of out) {
    if (typeof piece === "string") {
      result += piece;
      continue;
    }
    result += piece.cons;
    if (piece.vowel) result += piece.vowel;
    result += piece.nasal;
  }
  return result
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** Text as it should be handed to the TTS API for the given language. */
export function toSpeakable(text: string, lang?: string): string {
  return lang === "hi" ? devanagariToRoman(text) : text;
}
