// Upload de vídeo (UC-VID-005): classificação dos ficheiros selecionados e
// chamadas à API. Os limites por perfil são aplicados no servidor.
import axios from "axios";
import JSZip from "jszip";
import { api } from "./axios";
import { extractZipImages } from "./utils";
import type { SingleProject } from "./projects";

export const VIDEO_EXTENSIONS = [".mp4", ".mov"];
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

export const MIXED_MEDIA_MESSAGE = "Um projeto só pode conter imagens ou vídeos.";
export const UNSUPPORTED_FORMAT_MESSAGE = "Formato ou codec de vídeo não suportado.";
export const TRANSFER_FAILED_MESSAGE =
  "Falha na transferência do vídeo. Tente novamente.";

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

const baseName = (name: string) => name.split("/").pop() ?? name;

export const isVideoName = (name: string) => VIDEO_EXTENSIONS.includes(extOf(name));
export const isImageName = (name: string) => IMAGE_EXTENSIONS.includes(extOf(name));
export const isZipName = (name: string) => extOf(name) === ".zip";

export type MediaKind = "image" | "video" | "mixed" | "empty";

// Lista os ficheiros de um .zip sem os descompactar
export async function listZipEntries(file: File): Promise<string[]> {
  const zip = await new JSZip().loadAsync(file);
  return Object.values(zip.files)
    .filter(
      (f) =>
        !f.dir &&
        !f.name.startsWith("__MACOSX/") &&
        !baseName(f.name).startsWith("."),
    )
    .map((f) => f.name);
}

/**
 * Determina se a seleção (incluindo o conteúdo dos .zip) tem só imagens,
 * só vídeos, ou mistura os dois (RN9, Exceção 7).
 */
export async function getSelectionKind(
  files: File[],
): Promise<{ kind: MediaKind; zipEntries: string[] }> {
  const names: string[] = [];
  const zipEntries: string[] = [];

  for (const file of files) {
    if (isZipName(file.name)) {
      const entries = await listZipEntries(file);
      zipEntries.push(...entries);
      names.push(...entries);
    } else {
      names.push(file.name);
    }
  }

  const hasImages = names.some(isImageName);
  const hasVideos = names.some(isVideoName);

  const kind: MediaKind =
    hasImages && hasVideos
      ? "mixed"
      : hasVideos
        ? "video"
        : hasImages
          ? "image"
          : "empty";

  return { kind, zipEntries };
}

/**
 * Prepara os ficheiros largados/selecionados: um .zip só com imagens é
 * descompactado (comportamento original); um .zip com vídeos é mantido inteiro,
 * porque é transferido e descompactado no servidor (FA2).
 */
export async function normalizeDroppedFiles(
  acceptedFiles: File[],
  existingFiles: File[] = [],
): Promise<File[]> {
  const compatibleFiles: File[] = [];

  for (const file of acceptedFiles) {
    if (isZipName(file.name)) {
      const entries = await listZipEntries(file);
      if (entries.some(isVideoName)) compatibleFiles.push(file);
      else compatibleFiles.push(...(await extractZipImages(file)));
    } else if (isImageName(file.name) || isVideoName(file.name)) {
      compatibleFiles.push(file);
    }
  }

  // Handle duplicate names
  const duplicateNames = new Set<string>();
  existingFiles.forEach((file) => duplicateNames.add(file.name));
  return compatibleFiles.map((file) => {
    if (duplicateNames.has(file.name)) {
      const newFile = new File(
        [file],
        `${file.name.split(".")[0]} (${duplicateNames.size}).${file.name.split(".")[1]}`,
        { type: file.type },
      );
      duplicateNames.add(newFile.name);
      return newFile;
    }
    duplicateNames.add(file.name);
    return file;
  });
}

export function formatBytes(bytes: number) {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  if (bytes >= GB) return `${+(bytes / GB).toFixed(2)} GB`;
  return `${+(bytes / MB).toFixed(1)} MB`;
}

// ================== API ==================

export interface StorageInfo {
  type: "anonymous" | "free" | "premium";
  used: number;
  quota: number;
  limits: {
    maxFileSize: number;
    maxDuration: number;
    maxWidth: number;
    maxHeight: number;
    extensions: string[];
  };
}

export interface VideoUploadResult {
  accepted: string[];
  rejected: { name: string; reason: string }[];
  projectDeleted?: boolean;
  message?: string;
}

export const fetchStorage = async (uid: string, token: string) => {
  const response = await api.get<StorageInfo>(`/projects/${uid}/storage`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
};

/**
 * Cria o projeto de vídeo vazio. O servidor faz a validação preliminar
 * (extensões, tamanhos, quota, mistura de imagens e vídeos) antes de o criar.
 */
export const createVideoProject = async ({
  uid,
  token,
  name,
  files,
  zipEntries = [],
}: {
  uid: string;
  token: string;
  name: string;
  files: File[];
  zipEntries?: string[];
}) => {
  const response = await api.post<SingleProject>(
    `/projects/${uid}`,
    {
      name,
      type: "video",
      files: files.map((f) => ({ name: f.name, size: f.size })),
      zipEntries,
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (response.status !== 201 || !response.data)
    throw new Error("Failed to create project");

  return response.data;
};

/**
 * Transfere um vídeo (ou um .zip de vídeos) para o projeto, com progresso e
 * possibilidade de cancelamento através do `signal`.
 */
export const uploadProjectVideo = async ({
  uid,
  pid,
  token,
  file,
  signal,
  onProgress,
}: {
  uid: string;
  pid: string;
  token: string;
  file: File;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}): Promise<VideoUploadResult> => {
  const isZip = isZipName(file.name);
  const formData = new FormData();
  formData.append(isZip ? "zip" : "video", file);

  try {
    const response = await api.post<VideoUploadResult>(
      `/projects/${uid}/${pid}/video${isZip ? "/zip" : ""}`,
      formData,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        onUploadProgress: (e) => onProgress(e.total ? e.loaded / e.total : 0),
      },
    );
    return response.data;
  } catch (error) {
    // Vídeos rejeitados na validação vêm com o motivo no corpo da resposta
    const data = axios.isAxiosError(error) ? error.response?.data : undefined;
    if (data && typeof data === "object" && Array.isArray(data.rejected))
      return data as VideoUploadResult;
    throw error;
  }
};

export const sendSessionHeartbeat = async (uid: string, token: string) => {
  await api.post(
    `/projects/${uid}/heartbeat`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  );
};
