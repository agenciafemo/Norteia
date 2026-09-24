import { describe, expect, it } from "vitest";
import type { GeneratedContent } from "@/lib/contentGeneration";
import {
  generatedContentToDocument,
  generatedScriptScenes,
  generatedStaticCopy,
} from "@/lib/planningContentDocuments";

const content: GeneratedContent = {
  format: "video_script",
  title: "Consulta preventiva",
  strategy_summary: "Educar sem prometer resultado.",
  hook: "Você sabe quando procurar avaliação?",
  caption: "Informação ajuda a decidir com segurança.",
  cta: "Converse com um profissional.",
  hashtags: ["#saude"],
  carousel_slides: [],
  script_sections: [
    { order: 1, heading: "Abertura", body: "Observe os sinais.", visual_direction: "Plano médio" },
    { order: 2, heading: "Fecho", body: "Procure avaliação.", visual_direction: "Texto na tela" },
  ],
  compliance_notes: [],
  sources_used: ["Dossiê editorial do cliente"],
};

describe("planningContentDocuments", () => {
  it("preserva a estrutura da lauda ao converter roteiro da IA", () => {
    const scenes = generatedScriptScenes(content);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ speech: "Observe os sinais.", editing: "Plano médio", seconds: null });
  });

  it("gera copy curta sem inserir a estratégia interna", () => {
    expect(generatedStaticCopy(content)).toBe("Você sabe quando procurar avaliação?\n\nConverse com um profissional.");
  });

  it("mantém uma versão legível do documento", () => {
    expect(generatedContentToDocument(content)).toContain("ROTEIRO");
    expect(generatedContentToDocument(content)).toContain("LEGENDA");
  });
});
