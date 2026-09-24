export type ProductionPlanning = {
  id: string;
  month: number;
  year: number;
};

export type ProductionPlanningItem = {
  planning_id: string | null;
};

export type ProductionPlanningGroup<T extends ProductionPlanningItem> = {
  key: string;
  planning: ProductionPlanning | null;
  label: string;
  pieces: T[];
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Organiza as peças do cliente pelo planejamento mensal. Peças antigas ou
 * criadas diretamente no quadro continuam acessíveis em "Produções avulsas".
 */
export function groupProductionByPlanning<T extends ProductionPlanningItem>(
  items: T[],
  plannings: ProductionPlanning[],
): ProductionPlanningGroup<T>[] {
  const planningById = new Map(plannings.map((planning) => [planning.id, planning]));
  const grouped = new Map<string, ProductionPlanningGroup<T>>();

  for (const piece of items) {
    const planning = piece.planning_id ? planningById.get(piece.planning_id) ?? null : null;
    const key = planning ? planning.id : "avulsas";
    const current = grouped.get(key);

    if (current) {
      current.pieces.push(piece);
      continue;
    }

    grouped.set(key, {
      key,
      planning,
      label: planning
        ? `${MONTHS[planning.month - 1] ?? `Mês ${planning.month}`} ${planning.year}`
        : "Produções avulsas",
      pieces: [piece],
    });
  }

  return [...grouped.values()].sort((a, b) => {
    if (!a.planning) return 1;
    if (!b.planning) return -1;
    return (b.planning.year * 12 + b.planning.month) - (a.planning.year * 12 + a.planning.month);
  });
}
