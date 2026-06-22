import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWhatsAppParticipants,
  parseWhatsApp,
  sameParticipant,
} from "../src/lib/parseWhatsApp";

test("lê exportação Android e separa corretor de cliente", () => {
  const text = [
    "21/06/2026, 10:30 - Sanchai: Bom dia, Ana.",
    "21/06/2026, 10:31 - Ana: Bom dia. Queria entender a entrada.",
    "21/06/2026, 10:33 - Sanchai: Posso montar três opções.",
  ].join("\n");

  const parsed = parseWhatsApp(text, "Sanchai");
  assert.equal(parsed.count, 3);
  assert.deepEqual(parsed.participants, ["Sanchai", "Ana"]);
  assert.equal(parsed.themName, "Ana");
  assert.equal(parsed.messages.filter((m) => m.k === "me").length, 2);
  assert.equal(parsed.messages.filter((m) => m.k === "them").length, 1);
  assert.equal(parsed.lastSentAt, "2026-06-21T10:33:00");
});

test("lê exportação de iPhone com colchetes, segundos e AM/PM", () => {
  const text = [
    "[21/06/2026, 9:05:10 AM] Sanchai: Bom dia",
    "[21/06/2026, 1:15:20 PM] Cliente: Pode me enviar a planta?",
  ].join("\n");

  const parsed = parseWhatsApp(text, "Sanchai");
  assert.equal(parsed.count, 2);
  assert.equal(parsed.messages.find((m) => m.k === "them")?.t, "13:15");
  assert.equal(parsed.lastSentAt, "2026-06-21T13:15:20");
});

test("não anexa aviso de sistema à mensagem anterior", () => {
  const text = [
    "21/06/2026, 10:30 - Sanchai: Bom dia",
    "21/06/2026, 10:31 - As mensagens e as ligações são protegidas com a criptografia de ponta a ponta.",
    "21/06/2026, 10:32 - Ana: Olá",
  ].join("\n");

  const parsed = parseWhatsApp(text, "Sanchai");
  const first = parsed.messages.find((m) => m.k === "me");
  assert.equal(first?.text, "Bom dia");
  assert.equal(parsed.count, 2);
});

test("detecta áudio anexado e preserva data, lado e nome do arquivo", () => {
  const text = [
    "21/06/2026, 10:30 - Ana: 00000001-AUDIO-2026-06-21-10-30-00.opus (arquivo anexado)",
  ].join("\n");

  const parsed = parseWhatsApp(text, "Sanchai");
  const audio = parsed.messages.find((m) => m.k === "audio");
  assert.ok(audio);
  assert.equal(audio.from, "them");
  assert.equal(audio.file, "00000001-AUDIO-2026-06-21-10-30-00.opus");
  assert.equal(audio.sentAt, "2026-06-21T10:30:00");
});

test("extrai participantes sem depender do nome informado", () => {
  const text = [
    "21/06/2026, 10:30 - Cliente: Oi",
    "21/06/2026, 10:31 - Corretor: Olá",
    "21/06/2026, 10:32 - Cliente: Quero valores",
  ].join("\n");

  assert.deepEqual(extractWhatsAppParticipants(text), ["Cliente", "Corretor"]);
  assert.equal(sameParticipant("  Sanchai Kraemer ", "sanchai kraemer"), true);
});
