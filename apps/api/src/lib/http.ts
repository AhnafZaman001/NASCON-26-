import type { PostgrestError } from "@supabase/supabase-js";
import type { ZodTypeAny, z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** Validate input with zod; throws 400 with per-field messages. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
  throw new HttpError(400, "Some fields are invalid.", { fields });
}

/** Map a Postgres/PostgREST error to an HTTP error with a readable message. */
export function dbError(e: PostgrestError | null): HttpError | null {
  if (!e) return null;
  if (e.code === "P0001") return new HttpError(400, e.message);   // business rule (raise exception)
  if (e.code === "P0002") return new HttpError(404, e.message);   // not found in this workspace
  if (e.code === "23505") return new HttpError(409, "That already exists.");
  if (e.code === "23503") return new HttpError(409, "It is still referenced by other records.");
  return new HttpError(500, "Database error. Please try again.", { code: e.code });
}

/** Unwrap a supabase-js result or throw. */
export function must<T>(r: { data: T | null; error: PostgrestError | null }): T {
  const err = dbError(r.error);
  if (err) throw err;
  return r.data as T;
}
