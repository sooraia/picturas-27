"use client";

// Recorte temporal de vídeo (UC-VID-001): janela com os instantes inicial e
// final no formato hh:mm:ss; a confirmação adiciona o Trim à pipeline.

import { Scissors } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  useCanEditProject,
  useCurrentImage,
  useProjectInfo,
} from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import {
  useAddProjectTool,
  useDeleteProjectTool,
  useUpdateProjectTool,
} from "@/lib/mutations/projects";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error-messages";
import { TrimToolParams } from "@/lib/tool-types";
import { formatTime, TRIM_TOO_SHORT_MESSAGE, validateTrim } from "@/lib/video";

export default function TrimTool({ disabled }: { disabled: boolean }) {
  const project = useProjectInfo();
  const currentImage = useCurrentImage();
  const canEdit = useCanEditProject();
  const session = useSession();
  const searchParams = useSearchParams();
  const ownerParam = searchParams.get("owner") ?? session.user._id;
  const shareParam = searchParams.get("share") ?? undefined;
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("00:00:00");
  const [end, setEnd] = useState("00:00:00");

  const addTool = useAddProjectTool(session.user._id, project._id, session.token, ownerParam, shareParam);
  const updateTool = useUpdateProjectTool(session.user._id, project._id, session.token, ownerParam, shareParam);
  const deleteTool = useDeleteProjectTool(session.user._id, project._id, session.token, ownerParam, shareParam);

  const trimTool = project.tools.find((t) => t.procedure === "trim");
  const duration = currentImage?.duration;

  // Erro mostrado na janela; a confirmação fica indisponível enquanto existir (FA1)
  const error = useMemo(() => validateTrim(start, end, duration), [start, end, duration]);
  const pending = addTool.isPending || updateTool.isPending || deleteTool.isPending;

  useEffect(() => {
    if (!open) return;
    if (trimTool) {
      const params = trimTool.params as TrimToolParams;
      setStart(params.start);
      setEnd(params.end);
    } else {
      setStart("00:00:00");
      setEnd(formatTime(duration ?? 0));
    }
  }, [open, trimTool, duration]);

  const onError = (e: unknown) => {
    const { title, description } = getErrorMessage("project-update", e);
    toast({ title, description, variant: "destructive" });
  };

  function handleOpen() {
    if (!canEdit) {
      toast({
        title: "Read-only",
        description: "Este projeto foi partilhado com permissão de leitura.",
        variant: "destructive",
      });
      return;
    }
    // Exceção 2: vídeos com menos de 1 segundo não podem ser recortados
    if (duration !== undefined && duration < 1) {
      toast({ title: TRIM_TOO_SHORT_MESSAGE, variant: "destructive" });
      return;
    }
    setOpen(true);
  }

  function handleConfirm() {
    if (error) return;
    const params: TrimToolParams = { start, end };
    const done = { onSuccess: () => setOpen(false), onError };

    if (trimTool) {
      updateTool.mutate(
        { toolId: trimTool._id, toolParams: params, projectVersion: project.version },
        done,
      );
    } else {
      // O servidor coloca o Trim no início da pipeline (RN7)
      addTool.mutate(
        { tool: { procedure: "trim", params, position: 0 }, projectVersion: project.version },
        done,
      );
    }
  }

  function handleRemove() {
    if (!trimTool) return;
    deleteTool.mutate(
      { toolId: trimTool._id, projectVersion: project.version },
      { onSuccess: () => setOpen(false), onError },
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={trimTool ? "default" : "outline"}
            className="size-8"
            disabled={disabled || !canEdit || !currentImage}
            onClick={handleOpen}
          >
            <Scissors className="h-3.5 w-3.5" />
            <span className="sr-only">Trim</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="ml-2 bg-indigo-500" side="right">
          Trim
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trim</DialogTitle>
            <DialogDescription>
              {currentImage?.name}
              {duration !== undefined && ` — duração ${formatTime(duration)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="trim-start">Instante inicial</Label>
              <Input
                id="trim-start"
                placeholder="hh:mm:ss"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="trim-end">Instante final</Label>
              <Input
                id="trim-end"
                placeholder="hh:mm:ss"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2">
            {trimTool && (
              <Button variant="outline" onClick={handleRemove} disabled={pending}>
                Remover
              </Button>
            )}
            <Button onClick={handleConfirm} disabled={!!error || pending}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
