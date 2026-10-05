import { signPayload, verifyPayload } from "../crypto/tokens";

interface LocalDownloadClaims {
  /** storage key */
  k: string;
  /** expiry, seconds since epoch */
  e: number;
  /** file name offered to the browser */
  n: string;
}

/**
 * The local-disk equivalent of an S3 presigned URL: a link signed by the server
 * that the API will honour until it expires, with no session needed. This keeps
 * downloads working the same way whichever storage a backup lives in.
 */
export class LocalUrlSigner {
  constructor(
    private readonly signingKey: string,
    private readonly apiUrl: string,
  ) {}

  url(key: string, expiresInSeconds: number, fileName: string): string {
    const claims: LocalDownloadClaims = {
      k: key,
      e: Math.floor(Date.now() / 1000) + expiresInSeconds,
      n: fileName,
    };
    return `${this.apiUrl}/api/v1/storage/local/${signPayload(this.signingKey, claims)}`;
  }

  /** Returns the key and file name if the token is genuine and not expired. */
  verify(token: string): { key: string; fileName: string } | null {
    const claims = verifyPayload<LocalDownloadClaims>(this.signingKey, token);
    if (!claims || typeof claims.k !== "string" || typeof claims.e !== "number") return null;
    if (claims.e < Math.floor(Date.now() / 1000)) return null;
    return { key: claims.k, fileName: String(claims.n ?? "download") };
  }

  /** Extracts the token from a URL produced by `url()`. */
  tokenFromUrl(url: string): string {
    return url.slice(url.lastIndexOf("/") + 1);
  }
}
