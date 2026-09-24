import { describe, expect, it } from "vitest";
import {
  estimateSeconds,
  formatDuration,
  parseScenes,
  scenesSpokenText,
  serializeScenes,
  splitIntoScenes,
  totalSeconds,
} from "@/lib/scriptScenes";

describe("roteiro em blocos", () => {
  it("mantém fala e edição alinhadas ao serializar a lauda", () => {
    const scenes = serializeScenes([
      { id: "1", speech: "Primeira fala", editing: "Close no médico", seconds: 4 },
      { id: "2", speech: "Segunda fala", editing: "B-roll do consultório", seconds: null },
    ]);

    expect(scenes).toEqual([
      { id: "1", speech: "Primeira fala", editing: "Close no médico", seconds: 4 },
      { id: "2", speech: "Segunda fala", editing: "B-roll do consultório", seconds: null },
    ]);
    expect(scenesSpokenText(scenes!)).toBe("Primeira fala\n\nSegunda fala");
  });

  it("remove somente blocos completamente vazios", () => {
    expect(serializeScenes([
      { id: "1", speech: "", editing: "", seconds: null },
      { id: "2", speech: "", editing: "Inserir cartela", seconds: null },
    ])).toEqual([
      { id: "2", speech: "", editing: "Inserir cartela", seconds: null },
    ]);
  });

  it("converte texto antigo em blocos pelos parágrafos", () => {
    const scenes = splitIntoScenes("Abertura.\n\nDesenvolvimento.\n\nConclusão.");
    expect(scenes.map((scene) => scene.speech)).toEqual([
      "Abertura.",
      "Desenvolvimento.",
      "Conclusão.",
    ]);
  });

  it("estima e soma a duração quando não há ajuste manual", () => {
    const speech = Array.from({ length: 25 }, (_, index) => `palavra${index}`).join(" ");
    expect(estimateSeconds(speech)).toBe(10);
    expect(totalSeconds([
      { id: "1", speech, editing: "", seconds: null },
      { id: "2", speech: "ignorado", editing: "", seconds: 5 },
    ])).toBe(15);
    expect(formatDuration(75)).toBe("1:15");
  });

  it("tolera JSON antigo ou inválido sem quebrar o editor", () => {
    expect(parseScenes(null)).toEqual([]);
    expect(parseScenes({ speech: "fora do formato" })).toEqual([]);
    expect(parseScenes([{ id: "1", speech: "Fala", editing: 12, seconds: -2 }]))
      .toEqual([{ id: "1", speech: "Fala", editing: "", seconds: null }]);
  });
});
