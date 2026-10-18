import nodemailer from "nodemailer";
import { env } from "./env.ts";

export const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure,
  auth: { user: env.smtp.user, pass: env.smtp.pass },
  pool: true,
});

export type EmailRow = {
  id: string;
  user_id: string;
  from_email: string | null;
  to_email: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body_text: string | null;
  body_html: string | null;
  attempts: number;
  max_attempts: number;
};

export async function sendEmail(row: EmailRow) {
  const info = await transporter.sendMail({
    from: row.from_email ?? env.smtp.from,
    to: row.to_email,
    cc: row.cc.length ? row.cc : undefined,
    bcc: row.bcc.length ? row.bcc : undefined,
    subject: row.subject,
    text: row.body_text ?? undefined,
    html: row.body_html ?? undefined,
  });
  return info.messageId as string;
}
