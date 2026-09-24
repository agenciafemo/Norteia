import { describe, expect, it } from "vitest";
import { hasWrittenCopy, moveCarouselCopy, normalizeCarouselCopy } from "./postCopy";

describe("post copy helpers", () => {
  it("keeps one copy slot per carousel slide", () => {
    expect(normalizeCarouselCopy(["Capa", "Detalhe"], 3)).toEqual([
      "Capa",
      "Detalhe",
      "",
    ]);
    expect(normalizeCarouselCopy(["A", "B", "C"], 2)).toEqual(["A", "B"]);
    expect(normalizeCarouselCopy(null, 2)).toEqual(["", ""]);
  });

  it("moves copy together with its slide", () => {
    expect(moveCarouselCopy(["Capa", "Benefício", "CTA"], 1, 1)).toEqual([
      "Capa",
      "CTA",
      "Benefício",
    ]);
  });

  it("recognizes meaningful copy and ignores whitespace", () => {
    expect(hasWrittenCopy("   ", ["", "  "])).toBe(false);
    expect(hasWrittenCopy("Texto da arte", [])).toBe(true);
    expect(hasWrittenCopy("", ["", "Texto do slide"])).toBe(true);
  });
});
