"use client";

// Exportações de vídeo em curso num projeto (UC-VID-002): inicia a geração,
// acompanha o progresso pelo socket, permite cancelar e descarrega o ficheiro
// quando estiver pronto.

import axios from "axios";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./session-provider";
import { useToast } from "@/hooks/use-toast";
import { useGetSocket } from "@/lib/queries/projects";
import { downloadBlob } from "@/lib/utils";
import type { ProjectImage } from "@/lib/projects";
import {
  cancelVideoExport,
  EXPORT_FAILED_MESSAGE,
  getVideoExportDownload,
  startVideoExport,
  VideoExportUpdate,
} from "@/lib/video";

export interface VideoExportItem {
  exportId: string;
  imgId: string;
  fileName: string;
  progress: number; // 0-100
}

interface VideoExportContextData {
  exports: Record<string, VideoExportItem>; // por imgId
  startExport: (image: ProjectImage) => void;
  cancelExport: (imgId: string) => void;
}

const VideoExportContext = createContext<VideoExportContextData | undefined>(undefined);

export function VideoExportProvider({
  children,
  projectId,
  ownerId,
  shareId,
}: {
  children: React.ReactNode;
  projectId: string;
  ownerId?: string;
  shareId?: string;
}) {
  const session = useSession();
  const socket = useGetSocket(session.token);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [exports, setExports] = useState<Record<string, VideoExportItem>>({});
  const exportsRef = useRef(exports);
  exportsRef.current = exports;

  const target = { uid: session.user._id, pid: projectId, token: session.token, ownerId, shareId };

  const remove = useCallback((imgId: string) => {
    setExports((prev) => {
      const next = { ...prev };
      delete next[imgId];
      return next;
    });
  }, []);

  // Passo 5: disponibiliza o ficheiro e inicia a transferência no dispositivo
  const download = useCallback(
    async (exportId: string, imgId: string) => {
      try {
        const { url, fileName } = await getVideoExportDownload({ ...target, exportId });
        downloadBlob(fileName, url);
        qc.invalidateQueries({ queryKey: ["videoExportHistory", projectId, imgId] });
      } catch {
        toast({ title: EXPORT_FAILED_MESSAGE, variant: "destructive" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.user._id, session.token, projectId, ownerId, shareId, qc, toast],
  );

  const startExport = useCallback(
    async (image: ProjectImage) => {
      if (exportsRef.current[image._id]) return;

      try {
        const started = await startVideoExport({ ...target, imgId: image._id });

        // FA1: o ficheiro já existe e o resultado não mudou -> descarga imediata
        if (started.status === "done") {
          await download(started.exportId, image._id);
          return;
        }

        setExports((prev) => ({
          ...prev,
          [image._id]: {
            exportId: started.exportId,
            imgId: image._id,
            fileName: started.fileName,
            progress: 0,
          },
        }));
      } catch (error) {
        // Exceção 2 e RN1 chegam com a mensagem do servidor
        const data = axios.isAxiosError(error) ? error.response?.data : undefined;
        toast({
          title: "Exportação não iniciada",
          description: typeof data === "string" ? data : EXPORT_FAILED_MESSAGE,
          variant: "destructive",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.user._id, session.token, projectId, ownerId, shareId, download, toast],
  );

  // FA3: interrompe a geração; o servidor descarta o ficheiro parcial
  const cancelExport = useCallback(
    async (imgId: string) => {
      const item = exportsRef.current[imgId];
      if (!item) return;
      remove(imgId);
      try {
        await cancelVideoExport({ ...target, exportId: item.exportId });
        toast({ title: "Exportação cancelada", description: "O vídeo não foi alterado." });
      } catch {
        toast({ title: "Não foi possível cancelar a exportação", variant: "destructive" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.user._id, session.token, projectId, ownerId, shareId, remove, toast],
  );

  useEffect(() => {
    const s = socket.data;
    if (!s) return;

    const onUpdate = (evt: VideoExportUpdate) => {
      const item = Object.values(exportsRef.current).find((e) => e.exportId === evt?.exportId);
      if (!item) return;

      if (evt.status === "progress") {
        setExports((prev) =>
          prev[item.imgId]
            ? { ...prev, [item.imgId]: { ...prev[item.imgId], progress: evt.progress ?? 0 } }
            : prev,
        );
      } else if (evt.status === "done") {
        remove(item.imgId);
        // FA2: notificar quando o ficheiro está pronto
        toast({ title: "Exportação concluída", description: `${item.fileName} está pronto.` });
        download(item.exportId, item.imgId);
      } else if (evt.status === "error") {
        remove(item.imgId);
        toast({ title: evt.message || EXPORT_FAILED_MESSAGE, variant: "destructive" });
      }
    };

    s.on("export-update", onUpdate);
    return () => {
      s.off("export-update", onUpdate);
    };
  }, [socket.data, remove, download, toast]);

  return (
    <VideoExportContext.Provider value={{ exports, startExport, cancelExport }}>
      {children}
    </VideoExportContext.Provider>
  );
}

export function useVideoExports() {
  const context = useContext(VideoExportContext);
  if (context === undefined) {
    throw new Error("useVideoExports() must be used within a VideoExportProvider");
  }
  return context;
}
