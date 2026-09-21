import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { minutosInformados, TEMPO_MANUAL_MAX_MINUTOS } from "./runningTimer";

describe("tempo informado à mão", () => {
  it("45 minutos", () => {
    expect(minutosInformados(0, 45)).toBe(45);
  });

  it("2 horas", () => {
    expect(minutosInformados(2, 0)).toBe(120);
  });

  it("minutos acima de 60 viram horas", () => {
    expect(minutosInformados(1, 90)).toBe(150);
  });

  it("zero não é lançamento", () => {
    expect(minutosInformados(0, 0)).toBeNull();
  });

  it("negativo é recusado", () => {
    expect(minutosInformados(-1, 30)).toBeNull();
    expect(minutosInformados(1, -5)).toBeNull();
  });

  it("acima de 16h é recusado, igual ao banco", () => {
    expect(minutosInformados(16, 0)).toBe(TEMPO_MANUAL_MAX_MINUTOS);
    expect(minutosInformados(16, 1)).toBeNull();
  });

  it("campo vazio (NaN) não quebra", () => {
    expect(minutosInformados(Number.NaN, 30)).toBeNull();
  });
});
