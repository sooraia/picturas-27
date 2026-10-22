"use client";

// Progresso das exportações de vídeo em curso, com opção de cancelar
// (UC-VID-002, FA2, FA3, REQ-VID-EXPORT-007/008)

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useVideoExports } from "@/providers/video-export-provider";
import { LoaderCircle } from "lucide-react";

export default function VideoExportStatus() {
  const { exports, cancelExport } = useVideoExports();
  const items = Object.values(exports);

  if (items.length === 0) return null;

  return (
    <div className="border-b border-sidebar-border px-4 py-3 flex flex-col gap-2">
      <span className="text-sm font-semibold inline-flex items-center gap-2">
        A exportar <LoaderCircle className="size-[1em] animate-spin" />
      </span>
      <ul className="flex flex-col gap-2 max-h-48 overflow-y-auto">
        {items.map((item) => (
          <li key={item.exportId} className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between items-center gap-2">
              <span className="truncate">{item.fileName}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-muted-foreground">{item.progress}%</span>
                <Button variant="outline" size="sm" onClick={() => cancelExport(item.imgId)}>
                  Cancelar
                </Button>
              </div>
            </div>
            <Progress value={item.progress} />
          </li>
        ))}
      </ul>
    </div>
  );
}
