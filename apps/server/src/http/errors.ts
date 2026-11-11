export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Silakan masuk terlebih dahulu.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Peran Anda tidak diizinkan melakukan tindakan ini.") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Data tidak ditemukan.") => new HttpError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, "conflict", message, details);
export const tooMany = (message = "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.") => new HttpError(429, "rate_limited", message);
