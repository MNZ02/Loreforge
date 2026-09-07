import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

export const MAX_JSON_BYTES = 64 * 1024; // 64 KiB

export class CliInputError extends Error {
  constructor(
    public readonly code: "VALIDATION" | "IO",
    message: string,
    public readonly exitCode: number = code === "VALIDATION" ? 2 : 7
  ) {
    super(message);
    this.name = "CliInputError";
  }
}

/**
 * Reads bounded input from stdin or a file.
 * The 64 KiB byte limit is enforced incrementally while streaming chunks.
 * Enforces valid UTF-8 and valid JSON syntax without leaking input contents on error.
 */
export async function readBoundedInput(
  inputPath: string,
  stdinStream: NodeJS.ReadableStream = process.stdin
): Promise<Record<string, unknown>> {
  const stream: NodeJS.ReadableStream =
    inputPath === "-" ? stdinStream : createReadStream(inputPath, { highWaterMark: 16384 });

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      totalBytes += buf.length;
      if (totalBytes > MAX_JSON_BYTES) {
        if ("destroy" in stream && typeof stream.destroy === "function") {
          stream.destroy();
        }
        throw new CliInputError(
          "VALIDATION",
          `Input exceeds maximum size limit of ${MAX_JSON_BYTES} bytes (64 KiB)`
        );
      }
      chunks.push(buf);
    }
  } catch (err: unknown) {
    if (err instanceof CliInputError) {
      throw err;
    }
    // Differentiate IO failures (e.g. ENOENT, EACCES)
    const errorMsg = err instanceof Error ? err.message : "Stream read error";
    if (inputPath !== "-") {
      throw new CliInputError("IO", `Failed to read input file: ${errorMsg}`);
    }
    throw new CliInputError("IO", `Failed to read stdin: ${errorMsg}`);
  }

  const rawBuffer = Buffer.concat(chunks);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  try {
    text = decoder.decode(rawBuffer);
  } catch {
    throw new CliInputError("VALIDATION", "Input is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Never echo raw input or stack trace
    throw new CliInputError("VALIDATION", "Input is not valid JSON syntax");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliInputError("VALIDATION", "Input JSON must be an object");
  }

  const obj = parsed as Record<string, unknown>;
  if ("operation" in obj) {
    throw new CliInputError(
      "VALIDATION",
      "Field 'operation' must not be provided in input; operation is specified via CLI namespace and verb"
    );
  }

  return obj;
}
