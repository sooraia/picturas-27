"use client";

// Progresso das transferências de vídeo de um projeto, com opção de cancelar
// (UC-VID-005, Passo 5, REQ-VID-UP-003/004/010)

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useVideoUploads, VideoUploadItem } from "@/providers/video-upload-provider";
import { LoaderCircle, X } from "lucide-react";

function statusLabel(item: VideoUploadItem) {
  switch (item.status) {
    case "uploading":
      return `Em carregamento (${item.progress}%)`;
    case "validating":
      return "A validar…";
    case "done":
      return "Concluído";
    case "cancelled":
      return "Cancelado";
    case "error":
      return "Rejeitado";
  }
}

export default function VideoUploadStatus({ projectId }: { projectId: string }) {
  const { uploads, cancelUpload, clearUpload } = useVideoUploads();
  const upload = uploads[projectId];

  if (!upload) return null;

  return (
    <div className="border-b border-sidebar-border px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold inline-flex items-center gap-2">
          {upload.active ? (
            <>
              Em carregamento <LoaderCircle className="size-[1em] animate-spin" />
            </>
          ) : (
            "Carregamento terminado"
          )}
        </span>
        {upload.active ? (
          <Button variant="outline" size="sm" onClick={() => cancelUpload(projectId)}>
            Cancelar
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearUpload(projectId)}
            aria-label="Fechar"
          >
            <X />
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2 max-h-48 overflow-y-auto">
        {upload.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{item.name}</span>
              <span
                className={
                  item.status === "error"
                    ? "text-destructive shrink-0"
                    : "text-muted-foreground shrink-0"
                }
              >
                {statusLabel(item)}
              </span>
            </div>
            {(item.status === "uploading" || item.status === "validating") && (
              <Progress value={item.progress} />
            )}
            {item.message && (
              <span className="text-xs text-destructive">{item.message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
