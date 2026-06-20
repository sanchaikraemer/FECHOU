export type Side = "me" | "them";

export type MessageKind =
  | "div"
  | "me"
  | "them"
  | "audio";

export interface Message {
  k: MessageKind;
  from?: Side;
  text?: string;
  t?: string;
  transcript?: string;
  file?: string;
}

export interface RadarResult {
  prioridade: number;
  valeRetomar: boolean;
  oQueAconteceu: string;
  ondeTravou: string;
  faltouDescobrir: string[];
  motivoPrioridade: string;
  proximaAcao: string;
  mensagem: string;
}
