"use client";

// Estado das transferências de vídeo (UC-VID-005, Passos 5 a 7).
// Vive no layout do dashboard para que o progresso continue visível ao
// navegar entre a lista de projetos e a página do projeto.

import axios from "axios";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./session-provider";
import { useToast } from "@/hooks/use-toast";
import {
  MIXED_MEDIA_MESSAGE,
  TRANSFER_FAILED_MESSAGE,
  sendSessionHeartbeat,
  uploadProjectVideo,
} from "@/lib/video";

export type VideoUploadStatus =
  | "uploading"
  | "validating"
  | "done"
  | "error"
  | "cancelled";

export interface VideoUploadItem {
  id: string;
  name: string;
  progress: number; // 0-100
  status: VideoUploadStatus;
  message?: string;
}

export interface ProjectVideoUpload {
  projectId: string;
  items: VideoUploadItem[];
  active: boolean;
}

interface VideoUploadContextData {
  uploads: Record<string, ProjectVideoUpload>;
  startUpload: (projectId: string, files: File[]) => void;
  cancelUpload: (projectId: string) => void;
  clearUpload: (projectId: string) => void;
}

const VideoUploadContext = createContext<VideoUploadContextData | undefined>(
  undefined,
);

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function VideoUploadProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = useSession();
  const uid = session.user._id;
  const token = session.token;

  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  const [uploads, setUploads] = useState<Record<string, ProjectVideoUpload>>(
    {},
  );
  const controllers = useRef<Record<string, AbortController>>({});

  const updateItem = useCallback(
    (pid: string, id: string, patch: Partial<VideoUploadItem>) =>
      setUploads((prev) => {
        const upload = prev[pid];
        if (!upload) return prev;
        return {
          ...prev,
          [pid]: {
            ...upload,
            items: upload.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
          },
        };
      }),
    [],
  );

  const refresh = useCallback(
    (pid: string) => {
      qc.invalidateQueries({ queryKey: ["project", uid, pid], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["projects", uid, token], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["storage", uid, token], refetchType: "all" });
    },
    [qc, uid, token],
  );

  const startUpload = useCallback(
    async (pid: string, files: File[]) => {
      const controller = new AbortController();
      controllers.current[pid] = controller;

      const items: VideoUploadItem[] = files.map((f, i) => ({
        id: `${i}-${f.name}`,
        name: f.name,
        progress: 0,
        status: "uploading",
      }));
      setUploads((prev) => ({
        ...prev,
        [pid]: { projectId: pid, items, active: true },
      }));

      let accepted = 0;
      let projectDeleted = false;
      const rejected: { name: string; reason: string }[] = [];

      // Um ficheiro de cada vez; cada vídeo é validado de forma independente (RN4)
      for (let i = 0; i < files.length; i++) {
        const item = items[i];

        if (controller.signal.aborted) {
          updateItem(pid, item.id, { status: "cancelled" });
          continue;
        }

        try {
          const result = await uploadProjectVideo({
            uid,
            pid,
            token,
            file: files[i],
            signal: controller.signal,
            onProgress: (fraction) =>
              updateItem(pid, item.id, {
                progress: Math.round(fraction * 100),
                status: fraction >= 1 ? "validating" : "uploading",
              }),
          });

          accepted += result.accepted.length;
          rejected.push(...result.rejected);
          updateItem(pid, item.id, {
            progress: 100,
            status: result.accepted.length > 0 ? "done" : "error",
            message:
              result.rejected.length > 0
                ? result.rejected.map((r) => `${r.name}: ${r.reason}`).join(" · ")
                : undefined,
          });

          if (result.projectDeleted) {
            projectDeleted = true;
            break;
          }
          if (result.accepted.length > 0) refresh(pid);
        } catch (error) {
          if (axios.isCancel(error) || controller.signal.aborted) {
            updateItem(pid, item.id, { status: "cancelled" });
            continue;
          }

          // Sem resposta = ligação falhou (Exceção 5); senão, mensagem do servidor
          const data = axios.isAxiosError(error) ? error.response?.data : undefined;
          const message = typeof data === "string" ? data : TRANSFER_FAILED_MESSAGE;

          rejected.push({ name: files[i].name, reason: message });
          updateItem(pid, item.id, { status: "error", message });
        }
      }

      delete controllers.current[pid];
      setUploads((prev) =>
        prev[pid] ? { ...prev, [pid]: { ...prev[pid], active: false } } : prev,
      );
      refresh(pid);

      if (projectDeleted) {
        router.push("/dashboard");
        toast({
          title: "Projeto não criado",
          description: MIXED_MEDIA_MESSAGE,
          variant: "destructive",
        });
      } else if (controller.signal.aborted) {
        toast({
          title: "Carregamento cancelado",
          description:
            "O projeto mantém apenas os vídeos já transferidos e validados.",
        });
      } else if (rejected.length > 0) {
        toast({
          title:
            accepted > 0
              ? `${accepted} vídeo(s) adicionado(s), ${rejected.length} rejeitado(s)`
              : "Nenhum vídeo foi adicionado",
          description: rejected.map((r) => `${r.name}: ${r.reason}`).join("; "),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Vídeos carregados",
          description: `${accepted} vídeo(s) adicionado(s) ao projeto.`,
        });
      }
    },
    [uid, token, updateItem, refresh, router, toast],
  );

  const cancelUpload = useCallback((pid: string) => {
    controllers.current[pid]?.abort();
  }, []);

  const clearUpload = useCallback((pid: string) => {
    setUploads((prev) => {
      if (!prev[pid] || prev[pid].active) return prev;
      const next = { ...prev };
      delete next[pid];
      return next;
    });
  }, []);

  // Avisar antes de fechar a página com transferências em curso
  const anyActive = Object.values(uploads).some((u) => u.active);
  useEffect(() => {
    if (!anyActive) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyActive]);

  // Utilizador anónimo: enquanto a sessão estiver aberta, os seus projetos de
  // vídeo são mantidos; sem heartbeat são apagados pelo servidor (RN3)
  useEffect(() => {
    if (session.user.type !== "anonymous" || !uid || !token) return;

    const beat = () => sendSessionHeartbeat(uid, token).catch(() => {});
    beat();
    const i = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(i);
  }, [session.user.type, uid, token]);

  return (
    <VideoUploadContext.Provider
      value={{ uploads, startUpload, cancelUpload, clearUpload }}
    >
      {children}
    </VideoUploadContext.Provider>
  );
}

export function useVideoUploads() {
  const context = useContext(VideoUploadContext);
  if (context === undefined) {
    throw new Error("useVideoUploads() must be used within a VideoUploadProvider");
  }
  return context;
}
