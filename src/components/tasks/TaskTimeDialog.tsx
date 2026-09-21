import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addManualTaskTime, minutosInformados } from "@/lib/runningTimer";

/**
 * Pergunta quanto tempo a tarefa levou.
 *
 * Abre sozinho quando a tarefa vai para "Concluído" sem nenhum tempo
 * registrado — quem esquece de apertar "Iniciar" terminava com 0:00 e o tempo
 * gasto sumia dos relatórios. Também abre pelo "+" do card, para somar tempo
 * a qualquer momento.
 */

const ATALHOS = [
  { rotulo: "15 min", minutos: 15 },
  { rotulo: "30 min", minutos: 30 },
  { rotulo: "1h", minutos: 60 },
  { rotulo: "2h", minutos: 120 },
  { rotulo: "4h", minutos: 240 },
];

export type TaskTimeDialogMotivo = "concluida_sem_tempo" | "adicionar";

export function TaskTimeDialog({
  task,
  motivo,
  onClose,
  onSaved,
}: {
  /** null = fechado. */
  task: { id: string; title: string } | null;
  motivo: TaskTimeDialogMotivo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [horas, setHoras] = useState("");
  const [minutos, setMinutos] = useState("");
  const [nota, setNota] = useState("");

  // Cada tarefa começa com o formulário limpo.
  useEffect(() => {
    if (!task) return;
    setHoras("");
    setMinutos("");
    setNota("");
  }, [task]);

  const total = minutosInformados(Number(horas || 0), Number(minutos || 0));

  const salvar = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("Nenhuma tarefa selecionada");
      if (total === null) throw new Error("Informe entre 1 minuto e 16 horas");
      await addManualTaskTime(task.id, total, nota);
    },
    onSuccess: () => {
      toast.success("Tempo registrado na tarefa.");
      onSaved();
      onClose();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar o tempo"),
  });

  const escolherAtalho = (valor: number) => {
    setHoras(String(Math.floor(valor / 60)));
    setMinutos(String(valor % 60));
  };

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && !salvar.isPending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {motivo === "concluida_sem_tempo" ? "Quanto tempo levou?" : "Adicionar tempo"}
          </DialogTitle>
          <DialogDescription>
            {motivo === "concluida_sem_tempo"
              ? `"${task?.title ?? ""}" foi concluída sem tempo no cronômetro. Informe quanto você gastou.`
              : `Some o tempo que você trabalhou em "${task?.title ?? ""}" sem o cronômetro.`}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {ATALHOS.map((atalho) => (
              <button
                key={atalho.minutos}
                type="button"
                onClick={() => escolherAtalho(atalho.minutos)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  total === atalho.minutos
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                {atalho.rotulo}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tempo-horas">Horas</Label>
              <Input
                id="tempo-horas"
                type="number"
                inputMode="numeric"
                min={0}
                max={16}
                value={horas}
                onChange={(event) => setHoras(event.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tempo-minutos">Minutos</Label>
              <Input
                id="tempo-minutos"
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={minutos}
                onChange={(event) => setMinutos(event.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tempo-nota">Observação (opcional)</Label>
            <Input
              id="tempo-nota"
              value={nota}
              maxLength={300}
              onChange={(event) => setNota(event.target.value)}
              placeholder="Ex.: esqueci de iniciar o cronômetro"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Fica registrado como tempo informado, separado do medido pelo cronômetro.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={salvar.isPending}>
              {motivo === "concluida_sem_tempo" ? "Pular" : "Cancelar"}
            </Button>
            <Button type="submit" disabled={salvar.isPending || total === null}>
              {salvar.isPending ? "Salvando..." : "Registrar tempo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
