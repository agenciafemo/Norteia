import { describe, expect, it } from "vitest";
import { buildTeleprompterText, orderScriptsForLauda } from "@/lib/scriptLauda";

const roteiro = (id: string, position: number | null, spokenText: string) => ({
  id,
  title: id,
  position,
  spoken_text: spokenText,
  references_notes: null,
  editing_instructions: null,
});

describe("lauda do roteiro", () => {
  it("ordena roteiros pela posição antes de montar o teleprompter", () => {
    const scripts = [roteiro("segundo", 2, "Fala 2"), roteiro("primeiro", 1, "Fala 1")];
    expect(orderScriptsForLauda(scripts).map((script) => script.id)).toEqual(["primeiro", "segundo"]);
    expect(buildTeleprompterText(scripts)).toBe("Fala 1\n\nFala 2");
  });

  it("não leva instruções de edição para o teleprompter", () => {
    const script = { ...roteiro("um", 0, "Somente a fala"), editing_instructions: "Cortar para B-roll" };
    expect(buildTeleprompterText([script])).toBe("Somente a fala");
  });
});
