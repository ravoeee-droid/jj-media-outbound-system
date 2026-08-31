export type UploadProgressEvent = { percentage: number; loaded: number; total: number };
export declare function upload(
  pathname: string,
  file: Blob,
  options?: {
    access?: "private" | "public";
    handleUploadUrl?: string;
    contentType?: string;
    multipart?: boolean;
    clientPayload?: string;
    abortSignal?: AbortSignal;
    onUploadProgress?: (event: UploadProgressEvent) => void;
  },
): Promise<{ url: string; pathname: string }>;
