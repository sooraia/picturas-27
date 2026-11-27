"use client";

import { useState, useEffect, useRef } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { useGetSocket } from "@/lib/queries/projects";
import { useProjectInfo } from "@/providers/project-provider";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/providers/session-provider";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../ui/dialog";
import Image from "next/image";
import { useToast } from "@/hooks/use-toast";
import * as ProjectTypes from "@/lib/projects";
import { ProjectImage } from "./project-image";
import { useQueryClient } from "@tanstack/react-query";
import ProjectText from "./project-text";
import { getAiErrorMessage } from "@/lib/error-messages"; 
import { usePreview } from "@/providers/project-provider";

export function ProjectImageList({
  setCurrentImageId,
  results,
}: {
  setCurrentImageId: (img: ProjectTypes.ProjectImage) => void;
  results: {
    imgs: ProjectTypes.ProjectImage[];
    texts: ProjectTypes.ProjectImageText[];
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "grid";
  const mode = searchParams.get("mode") ?? "edit";
  const owner = searchParams.get("owner");
  const share = searchParams.get("share");  

  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string[] | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState<boolean>(false);

  useEffect(() => {
    const video = previewVideoRef.current;
    return () => video?.pause();
  }, [previewOpen, previewImage]);

  const project = useProjectInfo();
  const mediaItems = mode === "results" ? results.imgs : project.imgs;
  const session = useSession();
  const { toast } = useToast();
  const preview = usePreview();

  const qc = useQueryClient();
  const socket = useGetSocket(session.token);


useEffect(() => {
  let active = true;

  if (active && socket.data) {
    socket.data.on("preview-error", (msg: string) => {
      if (!active) return;

      try {
        const msg_content = JSON.parse(msg) as {
          error_code?: number;
          error_msg?: string;
        };

        const error_code = msg_content.error_code;
        const error_msg = msg_content.error_msg;

        console.error("preview-error", error_code, error_msg);

        const { title, description } = getAiErrorMessage(
          error_code,
          error_msg,
        );

        toast({
          title,
          description,
          variant: "destructive",
        });
      } catch (e) {

        const { title, description } = getAiErrorMessage();
        toast({
          title,
          description,
          variant: "destructive",
        });
      } finally {
          // preview falhou → limpa o estado de preview “em curso”
          preview.setWaiting("");
      }
    });

      socket.data.on("preview-ready", (msg: string) => {
        if (active) {
          const msg_content = JSON.parse(msg) as {
            imageUrl: string;
            textResults: string[];
            mediaType?: "video";
          };
          const url = msg_content.imageUrl;
          const textResults = msg_content.textResults;
          // fall back to the file extension (signed URLs carry a query string)
          const path = (url ?? "").split("?")[0].toLowerCase();
          setPreviewIsVideo(
            msg_content.mediaType === "video" ||
              [".mp4", ".mov", ".webm"].some((ext) => path.endsWith(ext)),
          );
          setPreviewImage(url);
          setPreviewText(textResults);
          setPreviewOpen(true);
        }
      });
    }

    return () => {
      active = false;
      if (socket.data) {
        socket.data.off("preview-error");
        socket.data.off("preview-ready");
      }
    };
  }, [socket.data, toast]);

  useEffect(() => {
    if (view === "grid") {
      setApi(undefined);
      setJumpTo(null);
    }
  }, [view]);

  useEffect(() => {
    if (!api) {
      return;
    }

    const handleSelect = () => {
      setCount(api.scrollSnapList().length);
      setCurrent(api.selectedScrollSnap() + 1);
      if (mediaItems[api.selectedScrollSnap()])
        setCurrentImageId(mediaItems[api.selectedScrollSnap()]);
    };

    handleSelect();
    api.on("select", handleSelect);
    api.on("reInit", handleSelect);

    if (jumpTo !== null && jumpTo !== api.selectedScrollSnap()) {
      api.scrollTo(jumpTo, true);
      setJumpTo(null);
    }

    return () => {
      api.off("select", handleSelect);
      api.off("reInit", handleSelect);
    };
  }, [api, jumpTo, mediaItems, setCurrentImageId]);

  return (
    <Dialog
      open={previewOpen}
      onOpenChange={() => {
        previewVideoRef.current?.pause();
        setPreviewOpen(false);
        setPreviewImage(null);
      }}
    >
      <div className="size-full">
        {view === "grid" || project.imgs.length <= 0 ? (
          // Grid view
          <div className="size-full flex flex-col items-center">
            {(mode === "edit" && project.imgs.length > 0) ||
            (mode === "results" &&
              (results.imgs.length > 0 || results.texts.length > 0)) ? (
              <>
                {mode !== "results" && (
                  <div className="relative pt-4 pb-2 text-gray-500 text-sm after:h-2 after:bg-gradient-to-b after:from-background after:to-background/10 after:w-full after:absolute after:bottom-0 after:translate-y-2 after:z-50 w-full text-center flex flex-col">
                    To start editing, select an image from the grid.
                  </div>
                )}
                <div className="grid w-full flex-1 min-h-0 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 p-2 overflow-auto">
                  {(mode === "results" ? results.imgs : project.imgs).map(
                    (image, index) => (
                      <button
                        key={image._id}
                        className="aspect-square min-w-0"
                        onClick={() => {
                          setJumpTo(index);

                          const params = new URLSearchParams();
                          params.set("mode", mode);
                          params.set("view", "carousel");
                          if (owner) params.set("owner", owner); 
                          if (share) params.set("share", share);   

                          router.push(`?${params.toString()}`);
                          qc.invalidateQueries({
                            queryKey: ["socket"],
                            refetchType: "all",
                          });
                        }}
                      >
                        <ProjectImage image={image} />
                      </button>
                    ),
                  )}
                  {mode === "results" &&
                    results.texts.map((text, index) => (
                      <button
                        key={text._id + index}
                        className="aspect-square"
                        onClick={() => {
                          setJumpTo(
                            (mode === "results" ? results.imgs.length : project.imgs.length) +
                              index,
                          );

                          const params = new URLSearchParams();
                          params.set("mode", mode);
                          params.set("view", "carousel");
                          if (owner) params.set("owner", owner);
                          if (share) params.set("share", share);   

                          router.push(`?${params.toString()}`);
                          qc.invalidateQueries({
                            queryKey: ["socket"],
                            refetchType: "all",
                          });
                        }}
                      >
                        <ProjectText text={text.text} />
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
                <p className="text-gray-500 text-xl">
                  {mode === "results"
                    ? "No results found. Apply your changes and try again."
                    : "Add some images to start."}
                </p>
              </div>
            )}
          </div>
        ) : (
          // Carousel view
          <div className="size-full px-2 sm:px-16 py-2">
            <Carousel setApi={setApi}>
              <CarouselContent className="aspect-auto h-[calc(100vh-99px-0.5rem-36px)] xl:h-[calc(100vh-55px-0.5rem-36px)]">
                {mode === "edit" &&
                  project.imgs.length > 0 &&
                  project.imgs.map((image, index) => (
                    <CarouselItem key={image._id}>
                      <ProjectImage image={image} animation={false} active={index === current - 1} />
                    </CarouselItem>
                  ))}
                {mode === "results" &&
                  results.imgs.length > 0 &&
                  results.imgs.map((image, index) => (
                    <CarouselItem key={image._id}>
                      <ProjectImage image={image} animation={false} active={index === current - 1} />
                    </CarouselItem>
                  ))}
                {mode === "results" &&
                  results.texts.length > 0 &&
                  results.texts.map((text) => (
                    <CarouselItem key={text.name}>
                      <ProjectText text={text.text} />
                    </CarouselItem>
                  ))}
              </CarouselContent>
              <CarouselPrevious className="hidden sm:flex" />
              <CarouselNext className="hidden sm:flex" />
            </Carousel>
            <div className="py-2 text-center text-sm text-muted-foreground">
              {current} / {count}
            </div>
          </div>
        )}
      </div>
      <DialogContent className="max-w-[80%] mt-4 overflow-y-scroll overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>
            {previewIsVideo ? "Video Preview (first seconds)" : "Image Preview"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-center items-center">
          {previewOpen && previewImage && previewIsVideo && (
            <video
              ref={previewVideoRef}
              src={previewImage}
              controls
              playsInline
              className="rounded-md w-full max-h-[80vh] bg-black"
            />
          )}
          {previewImage && !previewIsVideo && (
            <Image
              src={previewImage}
              width={500}
              height={500}
              className={`object-contain rounded-md w-full ${previewText ? "max-h-[60vh]" : "max-h-[80vh]"}`}
              alt="Preview"
              unoptimized
            />
          )}
        </div>
        {previewText && previewText.length > 0 && (
          <DialogFooter>
            <div className="flex flex-col gap-2 w-full h-96">
              {previewText.map((text, index) => (
                <iframe
                  src={text}
                  key={index}
                  className="text-sm text-center font-medium size-full"
                />
              ))}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
