// Shared BullMQ contract between the web app (producer) and apps/worker (consumer).
import { Queue, type ConnectionOptions } from "bullmq";

export const EMAIL_QUEUE = "emails";

/** Job payload: the worker sends every due `pending` row in `emails` for this user. */
export type EmailJob = { userId: string };

export function redisConnection(url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
}

let queue: Queue<EmailJob> | undefined;
export function emailQueue() {
  queue ??= new Queue<EmailJob>(EMAIL_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return queue;
}

/** Queue a send for one user. Repeated calls within the same second collapse into one job. */
export function enqueueUserEmails(userId: string) {
  return emailQueue().add("send-user-emails", { userId }, { jobId: `user-${userId}-${Math.floor(Date.now() / 1000)}` });
}
