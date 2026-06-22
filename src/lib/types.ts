export type Side = "me" | "them";

export type MessageKind = "div" | "me" | "them" | "audio";

export interface Message {
  k: MessageKind;
  from?: Side;
  sender?: string;
  text?: string;
  t?: string;
  date?: string;
  sentAt?: string;
  transcript?: string;
  file?: string;
  transcriptionFailed?: boolean;
}

export type NegotiationStage =
  | "descoberta"
  | "interesse"
  | "comparação"
  | "análise financeira"
  | "negociação"
  | "decisão"
  | "pós-venda"
  | "indefinida";

export type InterestLevel = "baixo" | "médio" | "alto" | "indefinido";

export interface RadarResult {
  prioridade: number;
  valeRetomar: boolean;
  tempoSemResposta: string;
  ultimaPessoaFalar: string;
  ultimoCompromissoCliente: string;
  ultimaInformacaoPrometida: string;
  produtoPrincipal: string;
  produtosParalelos: string[];
  objecaoRelevante: string;
  pendenciaFinanceira: string;
  quemDeveProximoPasso: string;
  etapaNegociacao: NegotiationStage;
  nivelInteresse: InterestLevel;
  oQueAconteceu: string;
  ondeTravou: string;
  faltouDescobrir: string[];
  motivoPrioridade: string;
  proximaAcao: string;
  mensagem: string;
}
