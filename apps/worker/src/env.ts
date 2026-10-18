function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see apps/worker/.env.example)`);
  return v;
}

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? required("SUPABASE_URL"),
  supabaseKey: required("SUPABASE_SECRET_KEY"),
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true") === "true",
    user: required("SMTP_USER"),
    pass: required("SMTP_PASS"),
    from: process.env.SMTP_FROM ?? required("SMTP_USER"),
  },
  concurrency: Number(process.env.EMAIL_CONCURRENCY ?? 5),
};
