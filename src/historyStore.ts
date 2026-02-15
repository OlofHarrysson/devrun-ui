import fs from "fs";
import path from "path";
import { DEVRUN_HOME } from "./storage";
import type { ServiceHistoryEvent, ServiceHistoryEventType } from "./types";

type HistoryBucket = {
  nextSeq: number;
  events: ServiceHistoryEvent[];
};

type HistoryFile = {
  version: 1;
  retention: number;
  services: Record<string, HistoryBucket>;
};

type AppendEventInput = {
  projectId: string;
  serviceName: string;
  runId?: string;
  type: ServiceHistoryEventType;
  data?: Record<string, unknown>;
};

type ListHistoryResult = {
  events: ServiceHistoryEvent[];
  latestSeq: number;
  nextAfterSeq: number;
  hasMore: boolean;
  retained: number;
};

const HISTORY_PATH = path.join(DEVRUN_HOME, "service-history.json");

function makeKey(projectId: string, serviceName: string) {
  return `${projectId}::${serviceName}`;
}

function ensureHistoryDir() {
  fs.mkdirSync(DEVRUN_HOME, { recursive: true });
}

function isHistoryBucket(input: unknown): input is HistoryBucket {
  if (!input || typeof input !== "object") {
    return false;
  }

  const candidate = input as Partial<HistoryBucket>;
  return (
    typeof candidate.nextSeq === "number" &&
    Number.isInteger(candidate.nextSeq) &&
    Array.isArray(candidate.events)
  );
}

export class ServiceHistoryStore {
  readonly retention: number;

  private readonly filePath: string;
  private readonly buckets = new Map<string, HistoryBucket>();

  constructor(options?: { retention?: number; filePath?: string }) {
    this.retention = Math.max(1, Math.min(options?.retention ?? 100, 1000));
    this.filePath = options?.filePath || HISTORY_PATH;
    this.load();
  }

  append(input: AppendEventInput): ServiceHistoryEvent {
    const key = makeKey(input.projectId, input.serviceName);
    const bucket = this.ensureBucket(key);

    const event: ServiceHistoryEvent = {
      seq: bucket.nextSeq,
      ts: new Date().toISOString(),
      projectId: input.projectId,
      serviceName: input.serviceName,
      runId: input.runId,
      type: input.type,
      data: input.data,
    };

    bucket.nextSeq += 1;
    bucket.events.push(event);

    if (bucket.events.length > this.retention) {
      bucket.events = bucket.events.slice(-this.retention);
    }

    this.buckets.set(key, bucket);
    this.persist();
    return event;
  }

  list(projectId: string, serviceName: string, afterSeq = 0, limit = 50): ListHistoryResult {
    const key = makeKey(projectId, serviceName);
    const bucket = this.buckets.get(key);
    if (!bucket || !bucket.events.length) {
      return {
        events: [],
        latestSeq: 0,
        nextAfterSeq: afterSeq,
        hasMore: false,
        retained: 0,
      };
    }

    const latestSeq = bucket.events[bucket.events.length - 1]?.seq || 0;
    const filtered = bucket.events.filter((event) => event.seq > afterSeq);
    const events = filtered.slice(0, limit);
    const nextAfterSeq = events.length ? events[events.length - 1].seq : afterSeq;

    return {
      events,
      latestSeq,
      nextAfterSeq,
      hasMore: nextAfterSeq < latestSeq,
      retained: bucket.events.length,
    };
  }

  clearProject(projectId: string) {
    let changed = false;
    for (const key of Array.from(this.buckets.keys())) {
      if (key.startsWith(`${projectId}::`)) {
        this.buckets.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.persist();
    }
  }

  private ensureBucket(key: string): HistoryBucket {
    const existing = this.buckets.get(key);
    if (existing) {
      return existing;
    }

    const fresh: HistoryBucket = {
      nextSeq: 1,
      events: [],
    };
    this.buckets.set(key, fresh);
    return fresh;
  }

  private load() {
    ensureHistoryDir();
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<HistoryFile>;
      const services = parsed.services && typeof parsed.services === "object"
        ? parsed.services
        : {};

      for (const [key, bucket] of Object.entries(services)) {
        if (!isHistoryBucket(bucket)) {
          continue;
        }

        const sorted = bucket.events
          .filter((event) => {
            return (
              event &&
              typeof event.seq === "number" &&
              Number.isInteger(event.seq) &&
              typeof event.ts === "string" &&
              typeof event.projectId === "string" &&
              typeof event.serviceName === "string" &&
              typeof event.type === "string"
            );
          })
          .sort((a, b) => a.seq - b.seq)
          .slice(-this.retention);

        const latestSeq = sorted[sorted.length - 1]?.seq || 0;
        this.buckets.set(key, {
          nextSeq: Math.max(bucket.nextSeq, latestSeq + 1),
          events: sorted,
        });
      }
    } catch {
      // Ignore malformed history file; keep runtime working.
    }
  }

  private persist() {
    ensureHistoryDir();
    const services: Record<string, HistoryBucket> = {};
    for (const [key, bucket] of this.buckets.entries()) {
      services[key] = {
        nextSeq: bucket.nextSeq,
        events: bucket.events,
      };
    }

    const payload: HistoryFile = {
      version: 1,
      retention: this.retention,
      services,
    };

    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
  }
}
