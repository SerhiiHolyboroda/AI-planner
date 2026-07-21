const MODEL = "gemini-3.1-flash-lite";

const TASK_SCHEMA = {
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
    suggested_tool: {
      type: "STRING",
      nullable: true,
      description:
        "The single real app, website, or AI tool best suited to actually help complete this specific task -- e.g. 'ChatGPT' or 'Claude' for drafting/writing/brainstorming, 'Canva' or 'Figma' for a design, 'Calendly' for scheduling a call, 'Notion' or 'Todoist' for organizing, 'GitHub Copilot' for coding, 'Grammarly' for editing text, 'Duolingo' for language practice, 'Google Maps' for planning a route, 'Instacart' for grocery shopping. Pick whatever genuinely fits the task -- don't force an AI tool onto a task that doesn't need one (e.g. 'call mom' doesn't need a tool). Use null only if nothing sensible applies.",
    },
  },
  required: ["title", "priority", "difficulty"],
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    action: {
      type: "STRING",
      enum: ["create", "move"],
      description:
        "'create' if the text describes one or more NEW tasks to add. 'move' if the text is a command to reschedule/move an EXISTING task that's already in the provided task list (using verbs like move/reschedule/shift/postpone/перемісти/пересунь/перенеси/зміни час, or any phrasing that clearly refers to an existing task by name and asks to change its time or date). When genuinely ambiguous, prefer 'create'.",
    },
    tasks: {
      type: "ARRAY",
      items: TASK_SCHEMA,
      description: "Populate only when action is 'create'. Empty array when action is 'move'.",
    },
    move_task_index: {
      type: "INTEGER",
      nullable: true,
      description:
        "Only when action is 'move': the array index (0-based) of the matched task within the provided existing-tasks list below -- NOT its id, just its position in that array. Null if action is 'create', or if no confident match was found.",
    },
    move_new_date: {
      type: "STRING",
      nullable: true,
      description:
        "Only relevant when action is 'move'. One of: an ISO date YYYY-MM-DD if the command specifies/implies a new day (e.g. 'tomorrow', 'Friday'); the literal string 'unscheduled' if it explicitly clears the date; or null if the command doesn't mention changing the date (keep the task's current date).",
    },
    move_new_time: {
      type: "STRING",
      nullable: true,
      description:
        "Only relevant when action is 'move'. One of: a 24h HH:MM if the command specifies a new time; the literal string 'clear' if it explicitly removes the time; or null if the command doesn't mention a time (keep the task's current time).",
    },
    move_message: {
      type: "STRING",
      nullable: true,
      description:
        "Only relevant when action is 'move'. A short (under ~12 words) confirmation or explanation, in the same language as the command. If matched, briefly confirm what changed. If no task matched, briefly say so.",
    },
  },
  required: ["action", "tasks"],
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

  const { text, now, tz, lang, existingTasks } = body;
  if (!text || !text.trim()) {
    return Response.json({ error: "No text provided." }, { status: 400 });
  }

  const nowDate = now ? new Date(now) : new Date();
  const todayIso = nowDate.toISOString().slice(0, 10);
  const localeTag = lang === "uk" ? "uk-UA" : "en-US";
  const weekday = nowDate.toLocaleDateString(localeTag, { weekday: "long" });
  const taskList = Array.isArray(existingTasks) ? existingTasks : [];

  const prompt = `You are the brain of a voice/text task planner. The person spoke or typed something, and you must first decide what they want, then do it.

Context: today is ${weekday}, ${todayIso}. Timezone: ${tz || "unknown"}.
The input may be in Ukrainian, English, or a mix of both (common with voice dictation).

STEP 1 - Decide the action:
- "create": the text describes one or more NEW tasks to add to the list.
- "move": the text is a command to reschedule an EXISTING task already in the list below -- it names (even approximately -- voice transcription is often imperfect) a task from that list and asks to change its time and/or date, using verbs like "move/reschedule/shift/postpone/push back" or Ukrainian equivalents like "перемісти/пересунь/перенеси/передвинь/зміни час/поміняй час" (and their various conjugations), or simply states a new time/date for something already on the list.
If genuinely ambiguous, prefer "create".

Existing tasks the person might be referring to, as a 0-indexed array (title, current time, current deadline -- refer to a task ONLY by its position in this array, e.g. the first element is index 0):
${JSON.stringify(taskList.map(({ title, time, deadline }) => ({ title, time, deadline })))}

STEP 2a - If action is "create": break the text into individual tasks and structure each one (see task schema). Handle relative dates/weekday names in either language ("завтра", "у четвер", "цих вихідних", "next Friday", "this weekend") resolved to absolute ISO dates based on today's date above. Keep each task's title in the language it was given -- do not translate. If no time is mentioned, leave time null; if no date, leave deadline null. Infer priority from urgency words in either language (терміново/важливо/urgent/ASAP/important -> high; колись/no rush -> low; else medium). Infer difficulty separately (mental/focus effort, not urgency). Give a realistic duration_minutes always. Generate 1-3 smart tags per task in its own language. Suggest one real, specific tool/app/AI per task that would genuinely help (skip if none fits). Split compound sentences into separate tasks.

STEP 2b - If action is "move": find the best-matching task by meaning/similarity (not exact string match) in the list above, and return its array INDEX (move_task_index, 0-based position in the list above) -- not any id, just the position. Resolve any relative date/time the command mentions into absolute values based on today's date, including a bare weekday name mentioned with no other date words (e.g. "п'ятницю", "on Friday") -- that alone means "move the date to the next upcoming occurrence of that weekday from today (today counts if today IS that weekday)". Work this out step by step: identify today's weekday and date, then count forward to the target weekday. Example: if today is Monday 2026-07-20 and the command mentions "п'ятницю"/"Friday", the resolved move_new_date is "2026-07-24" (four days later). If the command doesn't mention any date or weekday at all, leave move_new_date null (only the time changes); if it doesn't mention a time at all, leave move_new_time null (only the date changes). If you can't confidently identify the task, set move_task_index to null and explain briefly in move_message (in the same language as the command).

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
    return Response.json(parsed);
  } catch (e) {
    return Response.json(
      { error: e.message || "Failed to reach Gemini." },
      { status: 500 }
    );
  }
}
