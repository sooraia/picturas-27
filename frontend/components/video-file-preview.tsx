import { useEffect, useState } from "react";
import Loading from "./loading";

// Pré-visualização local de um vídeo ainda não transferido (UC-VID-005)
export default function VideoFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return <Loading />;

  return (
    <div className="grid rounded-lg overflow-hidden shadow-md border size-full max-h-full bg-black">
      <video
        src={url}
        muted
        controls
        preload="metadata"
        className="object-contain row-start-1 col-start-1 size-full"
      />
      <p
        className="row-start-1 col-start-1 z-30 h-4 max-w-full w-fit bg-background rounded-br-md text-xs truncate line-clamp-1 px-1 flex items-center"
        title={file.name}
      >
        {file.name}
      </p>
    </div>
  );
}
