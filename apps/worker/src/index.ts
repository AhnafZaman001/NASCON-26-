// BullMQ consumer: job = { userId } -> send that user's pending rows from public.emails.
import { Worker, type Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { EMAIL_QUEUE, emailQueue, redisConnection, type EmailJob } from "@nascon/queue";
import { env } from "./env.ts";
import { sendEmail, transporter, type EmailRow } from "./mailer.ts";

const db = createClient(env.supabaseUrl, env.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const RETRY_DELAY_MS = 60_000;

async function processJob(job: Job<EmailJob>) {
  const { userId } = job.data;
  if (!userId) throw new Error("job is missing userId");

  await db.rpc("release_stale_emails");
  const { data, error } = await db.rpc("claim_user_emails", { p_user_id: userId, p_limit: 50 });
  if (error) throw new Error(`claim_user_emails: ${error.message}`);
  const rows = (data ?? []) as EmailRow[];

  let sent = 0, failed = 0, retrying = 0;
  for (const row of rows) {
    try {
      const messageId = await sendEmail(row);
      await db.from("emails")
        .update({ status: "sent", sent_at: new Date().toISOString(), message_id: messageId, last_error: null })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const giveUp = row.attempts >= row.max_attempts;
      await db.from("emails")
        .update(giveUp
          ? { status: "failed", last_error: msg }
          : { status: "pending", last_error: msg, scheduled_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString() })
        .eq("id", row.id);
      giveUp ? failed++ : retrying++;
    }
  }

  // Rows put back for retry need a future job to pick them up.
  if (retrying) await emailQueue().add("send-user-emails", { userId }, { delay: RETRY_DELAY_MS });
  // More than one batch waiting: keep going.
  if (rows.length === 50) await emailQueue().add("send-user-emails", { userId });

  return { userId, claimed: rows.length, sent, failed, retrying };
}

await transporter.verify().then(
  () => console.log(`[worker] SMTP ok (${env.smtp.host})`),
  (e) => console.warn(`[worker] SMTP verify failed: ${e.message}`),
);

const worker = new Worker<EmailJob>(EMAIL_QUEUE, processJob, {
  connection: redisConnection(),
  concurrency: env.concurrency,
});

worker.on("ready", () => console.log(`[worker] listening on queue "${EMAIL_QUEUE}"`));
worker.on("completed", (job, r) => console.log(`[worker] job ${job.id} done`, r));
worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed: ${err.message}`));

const shutdown = async () => {
  await worker.close();
  transporter.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
