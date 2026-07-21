const MODEL = "gemini-3.1-flash-lite";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tasks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Short task description" },
          time: {
            type: "STRING",
            nullable: true,
            description: "24h HH:MM the task should happen at, or null if unspecified",
          },
          priority: {
            type: "STRING",
            enum: ["high", "medium", "low"],
            description: "Urgency, inferred from language; default medium if unclear",
          },
          deadline: {
            type: "STRING",
            nullable: true,
            description: "ISO date YYYY-MM-DD this task is due/scheduled for, or null",
          },
          duration_minutes: {
            type: "INTEGER",
            nullable: true,
            description:
              "Realistic estimate in minutes based on the real-world nature of the task - a quick email is ~10-15, a phone call ~15-30, a focused write-up or report ~60-120, a meeting matches its stated length. Give your best integer guess; only use null if truly unestimable.",
          },
          difficulty: {
            type: "STRING",
            enum: ["high", "medium", "low"],
            description:
              "Mental/focus effort the task requires, independent of urgency. Complex creative, analytical, or unfamiliar work is high; routine admin is low.",
          },
          tags: {
            type: "ARRAY",
            items: { type: "STRING" },
            description:
              "1-3 short lowercase topical tags inferred from the task (e.g. 'робота', 'дзвінок', 'навчання', 'email'). Match the language the task itself is in.",
          },
        },
        required: ["title", "priority", "difficulty"],
      },
    },
  },
  required: ["tasks"],
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

  const { text, now, tz, lang } = body;
  if (!text || !text.trim()) {
    return Response.json({ error: "No text provided." }, { status: 400 });
  }

  const nowDate = now ? new Date(now) : new Date();
  const todayIso = nowDate.toISOString().slice(0, 10);
  const localeTag = lang === "uk" ? "uk-UA" : "en-US";
  const weekday = nowDate.toLocaleDateString(localeTag, { weekday: "long" });

  const prompt = `You are a scheduling assistant. Break the following dictated or typed text into individual tasks and structure each one.

Context: today is ${weekday}, ${todayIso}. Timezone: ${tz || "unknown"}.
The input text may be in Ukrainian, English, or a mix of both (this often happens with voice dictation). Handle relative dates and weekday names in either language ("завтра", "у четвер", "цих вихідних", "next Friday", "this weekend", etc.) and resolve them into absolute ISO dates (YYYY-MM-DD) based on today's date above.
IMPORTANT: keep each task's "title" in the same language the person used for that task. Do NOT translate titles into English - priority, difficulty, and tags use their own rules below.
If no time of day is mentioned for a task, leave time null. If no date is mentioned, leave deadline null.
Infer priority from urgency words in either language: "urgent"/"ASAP"/"important"/"терміново"/"важливо"/"негайно" → high; routine tasks → medium; "sometime"/"no rush"/"колись"/"не поспішаючи" → low. Default to medium when unclear.
Infer difficulty separately from priority: it reflects how much focus/complexity the task needs, not how urgent it is.
Give a realistic duration_minutes for every task based on what the task actually involves.
Generate 1-3 short smart tags per task capturing its topic/category, in the same language as the task.
Split compound sentences into separate tasks when they describe distinct actions.

Text: """${text}"""`;

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
    return Response.json({ tasks: parsed.tasks || [] });
  } catch (e) {
    return Response.json(
      { error: e.message || "Failed to reach Gemini." },
      { status: 500 }
    );
  }
}
