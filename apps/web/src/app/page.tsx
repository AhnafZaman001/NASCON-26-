import { EVENT_NAME, EVENT_YEAR } from "@nascon/ui";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-5xl font-bold">
        {EVENT_NAME} &rsquo;{String(EVENT_YEAR).slice(2)}
      </h1>
    </main>
  );
}
