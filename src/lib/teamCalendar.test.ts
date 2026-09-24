import { describe, expect, it } from "vitest";
import { diffParticipantes, moverFim } from "./teamCalendar";

describe("mover o início arrasta o fim", () => {
  it("mantém a duração", () => {
    // O caso visto na prévia: 09:00–10:00 virava 11:30 com fim nas 10:00.
    expect(moverFim("09:00", "10:00", "11:30")).toBe("12:30");
    expect(moverFim("14:00", "16:00", "08:15")).toBe("10:15");
  });

  it("não inventa fim quando não dá para calcular", () => {
    expect(moverFim("09:00", "", "11:00")).toBe("");
    expect(moverFim("", "10:00", "11:00")).toBe("10:00");
    // Fim já estava antes do início: não é duração, é dado quebrado.
    expect(moverFim("10:00", "09:00", "11:00")).toBe("09:00");
  });

  it("não vira o dia", () => {
    expect(moverFim("09:00", "11:00", "23:00")).toBe("23:59");
  });
});

describe("participantes ao editar um evento", () => {
  it("quem continua na lista não é tocado", () => {
    // É o ponto do teste: reinserir quem ficou apagaria um "declined".
    const { adicionar, remover } = diffParticipantes(["ana", "bia"], ["ana", "bia"]);
    expect(adicionar).toEqual([]);
    expect(remover).toEqual([]);
  });

  it("separa quem entrou de quem saiu", () => {
    const { adicionar, remover } = diffParticipantes(["ana", "bia"], ["ana", "caio"]);
    expect(adicionar).toEqual(["caio"]);
    expect(remover).toEqual(["bia"]);
  });

  it("evento sem ninguém recebe todo mundo", () => {
    expect(diffParticipantes([], ["ana", "bia"])).toEqual({
      adicionar: ["ana", "bia"],
      remover: [],
    });
  });

  it("tirar todos os convidados remove todos", () => {
    expect(diffParticipantes(["ana", "bia"], [])).toEqual({
      adicionar: [],
      remover: ["ana", "bia"],
    });
  });

  it("repetido na entrada não vira convite em dobro", () => {
    expect(diffParticipantes(["ana", "ana"], ["ana", "bia", "bia"])).toEqual({
      adicionar: ["bia"],
      remover: [],
    });
  });
});
