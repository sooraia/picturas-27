"use client";

import AppDropzone from "@/components/app-dropzone";
import NewProjectDialog from "@/components/dashboard-sidebar/new-project-dialog";
import { normalizeDroppedFiles } from "@/lib/video";
import { ImagePlus } from "lucide-react";
import { useState } from "react";

export default function Dashboard() {
  const [files, setFiles] = useState<File[]>([]);

  const handleDrop = async (acceptedFiles: File[]) => {
    // Imagens, vídeos ou .zip abrem a janela "Create New Project" (FA1)
    setFiles(await normalizeDroppedFiles(acceptedFiles, files));
  };

  return (
    <div className="p-8 h-full">
      <NewProjectDialog files={files} setFiles={setFiles}>
        <AppDropzone onDrop={handleDrop}>
          <div className="flex flex-col gap-4 items-center justify-center max-w-[20rem]">
            <ImagePlus size={100} />
            <p className="text-2xl font-medium">
              Pick a project or drag and drop some images, videos or a .zip to
              create a new one
            </p>
          </div>
        </AppDropzone>
      </NewProjectDialog>
    </div>
  );
}
