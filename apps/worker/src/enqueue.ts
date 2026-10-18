// Manual trigger: npm run enqueue -w @nascon/worker -- <user-uuid>
import { emailQueue, enqueueUserEmails } from "@nascon/queue";

const userId = process.argv[2];
if (!userId) {
  console.error("usage: npm run enqueue -w @nascon/worker -- <user-uuid>");
  process.exit(1);
}
const job = await enqueueUserEmails(userId);
console.log(`queued job ${job.id} for user ${userId}`);
await emailQueue().close();
