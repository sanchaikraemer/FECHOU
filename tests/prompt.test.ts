import assert from "node:assert/strict";
import test from "node:test";
import { parseRadarJson, serializeConversation, systemPrompt } from "../src/lib/prompt";
import type { Message } from "../src/lib/types";

test("inclui transcrição de áudio, datas e tempo parado no texto enviado à IA", () => {
  const messages: Message[] = [
    {
      k: "me",
      from: "me",
      text: "Vou montar a simulação.",
      date: "20/06/2026",
      t: "10:00",
      sentAt: "2026-06-20T10:00:00",
    },
    {
      k: "audio",
      from: "them",
      transcript: "Consigo dar vinte mil de entrada.",
      file: "audio.opus",
      date: "20/06/2026",
      t: "10:05",
      sentAt: "2026-06-20T10:05:00",
    },
  ];

  const serialized = serializeConversation(messages, "Sanchai", new Date(2026, 5, 22, 10, 5));
  assert.match(serialized, /\[Áudio transcrito\] Consigo dar vinte mil de entrada/);
  assert.match(serialized, /há 2 dia\(s\)/);
  assert.match(serialized, /ÚLTIMA PESSOA A FALAR: Cliente/);
});

test("prompt contém regras comerciais obrigatórias", () => {
  const prompt = systemPrompt("Sanchai");
  assert.match(prompt, /Sem emojis/);
  assert.match(prompt, /faz sentido/);
  assert.match(prompt, /uma única pergunta principal/);
  assert.match(prompt, /último compromisso do cliente/i);
  assert.match(prompt, /pendência financeira/i);
});

test("normaliza JSON, limita prioridade e preserva diagnóstico", () => {
  const raw = JSON.stringify({
    prioridade: 120,
    valeRetomar: true,
    tempoSemResposta: "6 dias",
    ultimaPessoaFalar: "Cliente",
    ultimoCompromissoCliente: "Verificar entrada",
    ultimaInformacaoPrometida: "Simulação",
    produtoPrincipal: "Renaissance",
    produtosParalelos: ["Evolutti"],
    objecaoRelevante: "Entrada",
    pendenciaFinanceira: "R$ 20 mil",
    quemDeveProximoPasso: "Corretor",
    etapaNegociacao: "análise financeira",
    nivelInteresse: "alto",
    oQueAconteceu: "Resumo",
    ondeTravou: "Simulação não enviada",
    faltouDescobrir: ["Prazo"],
    motivoPrioridade: "Cliente informou capacidade de entrada",
    proximaAcao: "Enviar simulação",
    mensagem: "Ana, montei as opções. Qual delas você prefere analisar primeiro?",
  });

  const result = parseRadarJson(raw);
  assert.ok(result);
  assert.equal(result.prioridade, 100);
  assert.equal(result.etapaNegociacao, "análise financeira");
  assert.equal(result.nivelInteresse, "alto");
  assert.deepEqual(result.produtosParalelos, ["Evolutti"]);
});
