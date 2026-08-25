import type { Server as HttpServer } from "node:http";

export function safeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, ...(err.stack !== undefined ? { stack: err.stack } : {}) };
  }
  return { name: "Error", message: String(err) };
}

export async function listenHttpServer(httpServer: HttpServer, port: number, abortSignal: AbortSignal): Promise<void> {
  if (abortSignal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      if (abortSignal.aborted) {
        void closeHttpServer(httpServer).then(resolve, reject);
      } else {
        resolve();
      }
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port);
  });
}

export async function closeHttpServer(httpServer: HttpServer): Promise<void> {
  if (!httpServer.listening) return;
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
