import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAddProject, useCreateVideoProject } from "@/lib/mutations/projects";
import ImageSubmissionArea from "../image-submission-area";
import { useSession } from "@/providers/session-provider";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/error-messages";
import { getSelectionKind, MediaKind, MIXED_MEDIA_MESSAGE } from "@/lib/video";
import { useVideoUploads } from "@/providers/video-upload-provider";

export default function NewProjectDialog({
  files = [],
  setFiles,
  children,
}: {
  files?: File[];
  setFiles?: (files: File[]) => void;
  children: React.ReactNode;
}) {
  const { toast } = useToast();
  const router = useRouter();

  const [open, setOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);

  // Tipo da seleção: só imagens, só vídeos, ou mistura (RN9)
  const [selection, setSelection] = useState<{
    kind: MediaKind;
    zipEntries: string[];
  }>({ kind: "empty", zipEntries: [] });

  const session = useSession();
  const addProject = useAddProject(session.user._id, session.token);
  const createVideoProject = useCreateVideoProject(
    session.user._id,
    session.token,
  );
  const videoUploads = useVideoUploads();

  // Projeto de vídeo: o servidor valida e cria o projeto vazio; a transferência
  // começa depois, com progresso na página do projeto (UC-VID-005)
  function handleCreateVideo() {
    const files = imageFiles;
    createVideoProject.mutate(
      {
        uid: session.user._id,
        token: session.token,
        name: name,
        files,
        zipEntries: selection.zipEntries,
      },
      {
        onSuccess: (project) => {
          setOpen(false);
          toast({
            title: "Projeto criado com sucesso",
            description: "A transferir os vídeos para o novo projeto.",
          });
          router.push(`/dashboard/${project._id}`);
          videoUploads.startUpload(project._id, files);
        },
        onError: (error) => {
          const { title, description } = getErrorMessage("project-create", error);
          toast({
            title,
            description,
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleCreate() {
    if (selection.kind === "video") return handleCreateVideo();

    addProject.mutate(
      {
        uid: session.user._id,
        token: session.token,
        name: name,
        images: imageFiles,
      },
      {
        onSuccess: (project) => {
          setOpen(false);
          toast({
              title: "Projeto criado com sucesso",
              description: "As imagens foram adicionadas ao novo projeto.",
          });
          if (project) router.push(`/dashboard/${project._id}`);
        },
        onError: (error) => {
          const { title, description } = getErrorMessage("project-create", error);
          toast({
            title,
            description,
            variant: "destructive",
          });
        },
      },
    );
  }

  useEffect(() => {
    if (files.length > 0) {
      setOpen(true);
    }
  }, [files]);

  useEffect(() => {
    let active = true;
    getSelectionKind(imageFiles)
      .then((s) => active && setSelection(s))
      .catch(() => active && setSelection({ kind: "empty", zipEntries: [] }));
    return () => {
      active = false;
    };
  }, [imageFiles]);

  useEffect(() => {
    setName("");
    setImageFiles([]);
    if (setFiles && open === false) setFiles([]);
  }, [open, setFiles]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
        </DialogHeader>
        <Label htmlFor="project-name">Project Name</Label>
        <Input
          id="project-name"
          placeholder="Enter project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <ImageSubmissionArea
          onDrop={(files) => setImageFiles(files)}
          receivedFiles={files}
        />
        {selection.kind === "mixed" && (
          <p className="text-sm text-destructive">{MIXED_MEDIA_MESSAGE}</p>
        )}
        <DialogFooter>
          <Button
            onClick={() => handleCreate()}
            disabled={
              imageFiles.length <= 0 ||
              name.trim() === "" ||
              selection.kind === "mixed" ||
              selection.kind === "empty" ||
              createVideoProject.isPending
            }
            className="inline-flex items-center gap-1"
          >
            <span>Create</span>
            {(addProject.isPending || createVideoProject.isPending) && (
              <LoaderCircle className="size-[1em] animate-spin" />
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
