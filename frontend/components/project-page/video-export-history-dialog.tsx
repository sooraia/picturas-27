"use client";

// Histórico de exportações de um vídeo, com data e hora (UC-VID-002, REQ-VID-EXPORT-005)

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Loading from "@/components/loading";
import { useProjectInfo } from "@/providers/project-provider";
import { useSession } from "@/providers/session-provider";
import { fetchVideoExportHistory } from "@/lib/video";
import type { ProjectImage } from "@/lib/projects";

export default function VideoExportHistoryDialog({
  image,
  open,
  setOpen,
}: {
  image: ProjectImage;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const project = useProjectInfo();
  const session = useSession();
  const searchParams = useSearchParams();
  const ownerId = searchParams.get("owner") ?? session.user._id;
  const shareId = searchParams.get("share") ?? undefined;

  const history = useQuery({
    queryKey: ["videoExportHistory", project._id, image._id],
    queryFn: () =>
      fetchVideoExportHistory({
        uid: session.user._id,
        pid: project._id,
        token: session.token,
        ownerId,
        shareId,
        imgId: image._id,
      }),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Histórico de exportações</DialogTitle>
          <DialogDescription>{image.name}</DialogDescription>
        </DialogHeader>
        {history.isLoading ? (
          <Loading />
        ) : history.data && history.data.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm max-h-64 overflow-y-auto">
            {history.data.map((h, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{h.fileName}</span>
                <span className="text-muted-foreground shrink-0">
                  {new Date(h.exportedAt).toLocaleString("pt-PT")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Este vídeo ainda não foi exportado.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
