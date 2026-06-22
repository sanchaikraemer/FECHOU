import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedAudioFile, sanitizeAnalyzeBody } from "../src/lib/apiSecurity";

test("aceita áudio permitido e rejeita arquivo disfarçado", () => {
  const audio = new File([new Uint8Array([1, 2, 3])], "audio.opus", { type: "audio/opus" });
  const fake = new File([new Uint8Array([1, 2, 3])], "documento.pdf", { type: "application/octet-stream" });
  assert.equal(isAllowedAudioFile(audio), true);
  assert.equal(isAllowedAudioFile(fake), false);
});

test("sanitiza a conversa e rejeita payload vazio", () => {
  const valid = sanitizeAnalyzeBody({
    myName: "Sanchai",
    messages: [{ k: "them", text: "Quero informações", date: "21/06/2026", t: "10:00" }],
  });
  assert.ok(valid);
  assert.equal(valid?.messages[0].text, "Quero informações");
  assert.equal(sanitizeAnalyzeBody({ myName: "Sanchai", messages: [] }), null);
});
