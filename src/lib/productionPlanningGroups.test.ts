import { describe, expect, it } from "vitest";
import { groupProductionByPlanning } from "./productionPlanningGroups";

describe("groupProductionByPlanning", () => {
  it("separa as peças por planejamento e ordena do mais recente", () => {
    const result = groupProductionByPlanning(
      [
        { id: "a", planning_id: "plan-out" },
        { id: "b", planning_id: "plan-set" },
        { id: "c", planning_id: "plan-out" },
      ],
      [
        { id: "plan-set", month: 9, year: 2026 },
        { id: "plan-out", month: 10, year: 2026 },
      ],
    );

    expect(result.map((group) => group.label)).toEqual(["Outubro 2026", "Setembro 2026"]);
    expect(result[0].pieces.map((piece) => piece.id)).toEqual(["a", "c"]);
  });

  it("mantém peças sem planejamento em uma seção avulsa no fim", () => {
    const result = groupProductionByPlanning(
      [
        { id: "solta", planning_id: null },
        { id: "legada", planning_id: "removido" },
        { id: "planejada", planning_id: "plan" },
      ],
      [{ id: "plan", month: 1, year: 2027 }],
    );

    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Janeiro 2027");
    expect(result[1].label).toBe("Produções avulsas");
    expect(result[1].pieces.map((piece) => piece.id)).toEqual(["solta", "legada"]);
  });
});
