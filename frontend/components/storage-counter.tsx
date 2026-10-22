"use client";

// Espaço ocupado na quota de armazenamento do perfil (UC-VID-005, REQ-VID-UP-007)

import { useSession } from "@/providers/session-provider";
import { useGetStorage } from "@/lib/queries/projects";
import { Progress } from "./ui/progress";
import { formatBytes } from "@/lib/video";

export default function StorageCounter() {
  const session = useSession();
  const storage = useGetStorage(session.user._id, session.token);

  if (!storage.data) return null;

  const { used, quota } = storage.data;

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>Armazenamento de vídeo</span>
      <Progress value={Math.min(100, (used / quota) * 100)} className="h-1.5" />
      <span className="text-foreground">
        {formatBytes(used)} de {formatBytes(quota)} ({formatBytes(Math.max(0, quota - used))} livres)
      </span>
    </div>
  );
}
