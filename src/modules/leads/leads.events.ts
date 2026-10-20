import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

// One publisher per API process. Events invalidate views; they never contain leads.
export class LeadEvents {
  private readonly clients = new Set<Response>();
  private readonly instance = randomUUID();
  private revision = 0;

  subscribe(req: Request, res: Response): void {
    if (this.clients.size >= 100) {
      res.status(503).json({ error: { code: "STREAM_LIMIT", message: "Canal temporalmente ocupado" } });
      return;
    }
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    this.clients.add(res);
    res.write(`retry: 10000\nevent: ready\ndata: ${this.instance}:${this.revision}\n\n`);
    const heartbeat = setInterval(() => {
      if (!res.write(": keep-alive\n\n")) res.end();
    }, 25000);
    heartbeat.unref();
    res.once("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
    // Node emits request 'close' after its body is read, so use response close.
    req.once("aborted", () => res.end());
  }

  publish(): void {
    this.revision++;
    const revision = `${this.instance}:${this.revision}`;
    for (const res of this.clients) {
      if (res.destroyed || res.writableEnded) continue;
      if (!res.write(`id: ${revision}\nevent: leads-changed\ndata: ${revision}\n\n`)) res.end();
    }
  }

  close(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
