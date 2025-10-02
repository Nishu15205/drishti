// Shared Drishti constants — safe for both client and server

export type Lang = "en" | "hi";

export type ModeId =
  | "scene"
  | "currency"
  | "medicine"
  | "text"
  | "pehchaan"
  | "yaad";

export interface LangConfig {
  id: Lang;
  label: string;
  short: string;
}

export const LANGS: LangConfig[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "hi", label: "शुद्ध हिन्दी", short: "हिं" },
];

export interface ModeConfig {
  id: ModeId;
  label: string;
  sublabel: string;
  hint: string;
}

export const MODES: ModeConfig[] = [
  {
    id: "scene",
    label: "Aas-paas",
    sublabel: "Surroundings",
    hint: "Obstacles, people, landmarks — sab kuch batao",
  },
  {
    id: "currency",
    label: "Note pehchano",
    sublabel: "Currency",
    hint: "Indian notes & coins ki pehchaan",
  },
  {
    id: "medicine",
    label: "Dawai label",
    sublabel: "Medicine",
    hint: "Dawai ka naam, dose, expiry sunao",
  },
  {
    id: "text",
    label: "Text padho",
    sublabel: "Read text",
    hint: "Boards, signs, printed text padh kar sunao",
  },
  {
    id: "pehchaan",
    label: "Pehchaan",
    sublabel: "Known faces",
    hint: "Apne log pehchano — Mummy, bhai, dost",
  },
  {
    id: "yaad",
    label: "Cheez dhundo",
    sublabel: "Find things",
    hint: "Apni cheezein dhundo — chabi, bag, bottle",
  },
];

export interface DemoPhoto {
  id: string;
  url: string;
  label: string;
  mode: ModeId;
}

// Pre-tested backup photos — live camera glitch hone par ye use karo
export const DEMO_PHOTOS: DemoPhoto[] = [
  { id: "street", url: "/demo/street.png", label: "Street crossing", mode: "scene" },
  { id: "roof", url: "/demo/roof.png", label: "Terrace edge", mode: "scene" },
  { id: "danger", url: "/demo/danger.png", label: "Traffic danger", mode: "scene" },
  { id: "busstop", url: "/demo/busstop.png", label: "Bus stop", mode: "scene" },
  { id: "hallway", url: "/demo/hallway.png", label: "Living room", mode: "scene" },
  { id: "stairs", url: "/demo/stairs.png", label: "Stairs ahead", mode: "scene" },
  { id: "currency", url: "/demo/currency.png", label: "Cash notes", mode: "currency" },
  { id: "medicine", url: "/demo/medicine.png", label: "Medicine", mode: "medicine" },
  { id: "exit-board", url: "/demo/exit-board.png", label: "Exit board", mode: "text" },
  { id: "person", url: "/demo/person.png", label: "Visitor (Pehchaan)", mode: "pehchaan" },
  { id: "keys", url: "/demo/keys.png", label: "Keys on table (Yaad)", mode: "yaad" },
];

// Per-language speech pace (user requests: "hindi thoda fast bole" but
// "english thoda slow bole"). The settings slider adjusts the CURRENT
// language's speed; switching language restores that language's own pace.
// Hindi applies its pace as pitch-corrected playbackRate (Hindi API
// synthesizes at normal speed); English bakes its pace into cloud synthesis.
export const DEFAULT_SPEEDS: Record<Lang, number> = { en: 1.0, hi: 1.5 };
