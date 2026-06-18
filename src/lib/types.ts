export type Tone = "amigavel" | "direto" | "formal";
export type Screen = "inbox" | "importing" | "chat";
export type StatusTone = "cold" | "warm" | "hot" | "new";
export type Side = "me" | "them";

export interface PropRow {
  l: string;
  v: string;
}

export type MessageKind =
  | "div"
  | "me"
  | "them"
  | "audio"
  | "proposal"
  | "doc"
  | "image";

export interface Message {
  k: MessageKind;
  from?: Side;
  text?: string;
  t?: string;
  transcript?: string;
  dur?: string;
  propTitle?: string;
  propTotal?: string;
  propRows?: PropRow[];
  propNote?: string;
  best?: boolean;
  docName?: string;
  docMeta?: string;
  src?: string;
  cap?: string;
  /** Nome do arquivo de áudio (.opus) no export — usado para casar com o upload e transcrever. */
  file?: string;
}

export interface AnalysisChip {
  label: string;
  value: string;
}

export interface Analysis {
  oneLine: string;
  chips: AnalysisChip[];
  summary: string;
  frictions: string[];
  rec: string;
  source: string;
}

export interface Suggestion {
  cat: string;
  accent: string;
  t: Record<Tone, string>;
}

export interface Conversation {
  id: string;
  name: string;
  initials: string;
  color: string;
  property: string;
  price: string;
  statusLabel: string;
  statusTone: StatusTone;
  group: "ativas" | "frias";
  snippet: string;
  time: string;
  hasSug: boolean;
  aiNote: string;
  reply: string;
  analysis: Analysis;
  messages: Message[];
  suggestions: Suggestion[];
}

/** Forma crua do JSON que a IA (GPT) devolve. */
export interface AiSuggestionRaw {
  cat?: string;
  amigavel?: string;
  direto?: string;
  formal?: string;
}

export interface AiResult {
  oneLine?: string;
  chips?: AnalysisChip[];
  summary?: string;
  frictions?: string[];
  rec?: string;
  suggestions?: AiSuggestionRaw[];
}
