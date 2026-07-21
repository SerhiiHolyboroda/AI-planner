const MODEL = "gemini-3.1-flash-lite";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    matched: {
      type: "BOOLEAN",
      description: "True if you found a specific existing task this command clearly refers to.",
    },
    task_id: {
      type: "STRING",
      nullable: true,
      description: "The id of the matched task, copied exactly from the provided task list. Null if not matched.",
    },
    new_date: {
      type: "STRING",
      nullable: true,
      description:
        "One of: an ISO date YYYY-MM-DD if the command specifies (or implies, e.g. 'tomorrow', 'Friday') a new day; the literal string 'unscheduled' if the command explicitly clears the date; or null if the command doesn't mention changing the date at all (keep the task's current date).",
    },
    new_time: {
      type: "STRING",
      nullable: true,
      description:
        "One of: a 24h HH:MM if the command specifies a new time; the literal string 'clear' if the command explicitly removes the time; or null if the command doesn't mention a time (keep the task's current time).",
    },
    message: {
      type: "STRING",
      description:
        "A short (under ~12 words) confirmation or explanation, written in the same language as the command (Ukrainian or English). If matched, briefly confirm what changed (e.g. 'Перенесено на п'ятницю о 15:00'). If not matched, briefly say no matching task was found.",
    },
  },
  required: ["matched", "message"],
};

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing GEMINI_API_KEY. Add it in Vercel project settings." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { text, now, tz, lang, tasks } = body;
  if (!text || !text.trim()) {
    return Response.json({ error: "No text provided." }, { status: 400 });
  }

  const nowDate = now ? new Date(now) : new Date();
  const todayIso = nowDate.toISOString().slice(0, 10);
  const localeTag = lang === "uk" ? "uk-UA" : "en-US";
  const weekday = nowDate.toLocaleDateString(localeTag, { weekday: "long" });
  const taskList = Array.isArray(tasks) ? tasks : [];

  const prompt = `You are a voice-command interpreter for a task planner. The person spoke or typed a command asking to move/reschedule an existing task. Your job is to figure out WHICH task they mean and WHERE it should move to.

Context: today is ${weekday}, ${todayIso}. Timezone: ${tz || "unknown"}.
The command may be in Ukrainian or English, and may use verbs like "перемісти", "пересунь", "перенеси", "move", "reschedule", "shift", "postpone".
Voice dictation is often imperfect, so match the task by meaning/similarity, not exact string equality -- small mis-transcriptions of the title are expected and fine to match through.
Resolve any relative date/time the command mentions ("завтра", "у п'ятницю", "наступного тижня", "tomorrow", "next Friday", "at 3pm") into absolute values based on today's date above.
If the command doesn't mention a new date, leave new_date null (don't touch the date). If it doesn't mention a new time, leave new_time null (don't touch the time).
If you cannot confidently identify which task is meant, set matched to false and explain briefly in the message.

Existing tasks (id, title, current time, current deadline):
${JSON.stringify(taskList)}

Command: """${text}"""`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      return Response.json(
        { error: `Gemini API error (${res.status}): ${errBody.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return Response.json({ error: "No content returned from Gemini." }, { status: 502 });
    }

    const parsed = JSON.parse(raw);
    return Response.json(parsed);
  } catch (e) {
    return Response.json(
      { error: e.message || "Failed to reach Gemini." },
      { status: 500 }
    );
  }
}
