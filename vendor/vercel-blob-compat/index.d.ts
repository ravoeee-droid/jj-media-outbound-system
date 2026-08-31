export type PutOptions = {
  access?: "private" | "public";
  contentType?: string;
  addRandomSuffix?: boolean;
};
export type BlobBody = BodyInit | Uint8Array | Buffer;
export declare function put(pathname: string, body: BlobBody, options?: PutOptions): Promise<{ url: string; pathname: string; contentType?: string }>;
export declare function get(pathOrUrl: string, options?: { access?: "private" | "public"; useCache?: boolean }): Promise<{ stream: ReadableStream<Uint8Array> | null; contentType: string; size: number; pathname: string; url: string } | null>;
export declare function del(pathOrUrl: string): Promise<void>;
export declare function issueSignedToken(options: { pathname: string; operations?: string[]; validUntil?: number }): Promise<string>;
export declare function presignUrl(token: string, options?: { pathname?: string; operation?: string; access?: string; validUntil?: number }): Promise<{ presignedUrl: string }>;
