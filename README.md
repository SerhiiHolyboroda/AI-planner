# Rail — voice task planner

Speak or type your day/week's tasks; Gemini structures them into a timed,
prioritized schedule with smart tags, difficulty, and realistic duration
estimates. Runs on Next.js, deploys free on Vercel.

## Features
- Voice (Ukrainian or English) or text capture, via the browser's native
  Web Speech API
- Gemini 3.1 Flash-Lite structures free text into tasks: time, priority,
  deadline, realistic duration, difficulty, AI-generated smart tags, and a
  recommended real tool/app/AI to help complete each task (e.g. ChatGPT for
  drafting, Canva for a design, Calendly for scheduling a call) -- editable
  per task in the detail view if the suggestion isn't quite right
- Today / Week views
- Tap any task to open, edit, add notes and subtasks
- Filter by priority and by smart tags
- Drag any task by its grip handle (the ⠿ icon on the left of each row):
  while (and only while) you're dragging, free hourly time frames
  (7:00-21:00) appear interleaved with your existing tasks for every
  visible day, showing exactly where there's open room. Drop on a free
  frame and the task's time changes to that frame. Drop directly on
  another task and your task takes its exact slot, pushing that task
  (and everything after it that day) later. Works across different days
  in Week view too. Built on Pointer Events (not native HTML5
  drag-and-drop) so it works the same on touchscreens and with a mouse.
- "Auto-plan hard tasks -> morning" — a free, instant client-side heuristic
  that pulls your undone, high-priority/high-difficulty tasks into
  sequential morning slots starting 8:00am
- Voice commands to reschedule existing tasks -- just speak or type things
  like "перемісти зустріч на завтра о 15:00" or "move the deck review to
  Friday". The same composer/button used to add tasks sends your current
  task list to Gemini along with the text, and Gemini itself decides
  whether you're describing new task(s) or asking to move an existing one
  (rather than the app pre-guessing off a fixed keyword list, which missed
  a lot of real phrasing). If it's a move, it finds the matching task by
  meaning (fuzzy -- voice transcription doesn't have to be exact) and
  reschedules it, closing the gap in its old day the same way dragging
  does. (Internally this matches by array index rather than task id, since
  models are unreliable at copying long ids back exactly -- an index is
  just a small number, which they get right consistently.) A matching
  title alone never triggers a move -- an explicit move-verb
  ("перемісти"/"move"/etc.) must be present, so saying "add a task called
  X" creates a second X instead of relocating the existing one.
- Tasks persist in the browser's localStorage — private to your device,
  no database needed

## 1. Get a free Gemini API key
1. Go to https://aistudio.google.com/apikey
2. Sign in, click "Create API key" — no credit card needed.
3. Copy the key.

IMPORTANT: never paste your key into chat, commit it to git, or hardcode
it in a file. It only ever belongs in `.env.local` (local dev) or your
Vercel project's Environment Variables (production).

## 2. Run locally
```bash
npm install
cp .env.example .env.local
# paste your key into .env.local as GEMINI_API_KEY=...
npm run dev
```
Open http://localhost:3000 on your phone (same wifi) or desktop Chrome —
Chrome has the best Web Speech API support for the mic button.

## 3. Deploy to Vercel
```bash
npm i -g vercel
vercel
```
Follow the prompts (link/create project). Then add your key:
```bash
vercel env add GEMINI_API_KEY
```
Paste the key when prompted, choose all environments, then:
```bash
vercel --prod
```
Or do it via the Vercel dashboard: Project -> Settings -> Environment
Variables -> add `GEMINI_API_KEY` -> redeploy.

## 4. Add it to your home screen
On iPhone: open the Vercel URL in Safari -> Share -> "Add to Home Screen".
On Android: open in Chrome -> menu -> "Add to Home screen".

## Notes
- The Gemini key lives only on the server (`app/api/parse/route.js`),
  never sent to the browser.
- Data model per task: title, time, priority, deadline, duration_minutes,
  difficulty, tags[], suggested_tool, notes, subtasks[], done, order.
- Model used: `gemini-3.1-flash-lite`. Swap the `MODEL` constant in
  `app/api/parse/route.js` if you want a different one.
- Storage key bumped to `rail.tasks.v2` since the data shape changed
  (subtasks, tags, done, order) — old test data from earlier versions
  won't carry over.
