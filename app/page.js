"use client";

import { useEffect, useRef, useState } from "react";
import TaskDetailSheet from "./components/TaskDetailSheet";

const PRIORITY_COLOR = { high: "var(--high)", medium: "var(--medium)", low: "var(--low)" };
const PRIORITY_LABEL = {
  uk: { high: "високий", medium: "середній", low: "низький" },
  en: { high: "high", medium: "medium", low: "low" },
};
const LANGUAGES = { uk: { code: "uk-UA", label: "UA" }, en: { code: "en-US", label: "EN" } };
const STORAGE_KEY = "rail.tasks.v2";
const LANG_STORAGE_KEY = "rail.lang.v1";

// Hour range in which free-time markers are offered while dragging.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

const T = {
  uk: {
    today: "Сьогодні", week: "Тиждень", yourSchedule: "Ваш розклад", clearAll: "Очистити все",
    empty: "Поки що порожньо. Скажіть або введіть кілька завдань вище, щоб почати.",
    noTasks: "Немає завдань", dropHere: "Перетягніть сюди", free: "вільно",
    speak: "Говорити", listening: "● Слухаю…",
    structure: "Розкласти →", structuring: "Розкладаю…",
    placeholder: "Скажіть або введіть свої завдання — напр. «завершити презентацію до четверга 17:00, високий пріоритет»",
    autoPlan: "Авто-план: складне на ранок",
  },
  en: {
    today: "Today", week: "Week", yourSchedule: "Your schedule", clearAll: "Clear all",
    empty: "Nothing on the rail yet. Speak or type a few tasks above to get started.",
    noTasks: "No tasks", dropHere: "Drop here", free: "free",
    speak: "Speak", listening: "● Listening…",
    structure: "Structure it →", structuring: "Structuring…",
    placeholder: "Speak or type your tasks — e.g. \u201cfinish the deck by Thursday 5pm, high priority\u201d",
    autoPlan: "Auto-plan hard tasks -> morning",
  },
};

function loadTasks() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveTasks(tasks) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch {}
}
function groupKey(task) { return task.deadline || "unscheduled"; }
function toISODate(d) { return d.toISOString().slice(0, 10); }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function sortByTime(items) {
  return [...items].sort((a, b) => {
    const ta = timeToMinutes(a.time), tb = timeToMinutes(b.time);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });
}
// Chains a sorted day's tasks back-to-back, starting from the first task's
// own time (or 8:00 default), so nothing overlaps after a task is removed
// or inserted.
function reflowDay(items) {
  const sorted = sortByTime(items);
  let cursor = null;
  return sorted.map((tk, i) => {
    const start = i === 0 ? (timeToMinutes(tk.time) ?? 8 * 60) : cursor;
    const dur = tk.duration_minutes || 30;
    cursor = start + dur;
    return { ...tk, time: minutesToHHMM(start) };
  });
}
function groupLabel(key, todayStr, lang) {
  if (key === "unscheduled") return lang === "uk" ? "Без дати" : "No date";
  if (key === todayStr) return lang === "uk" ? "Сьогодні" : "Today";
  try {
    const d = new Date(key + "T00:00:00");
    return d.toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", { weekday: "long", month: "short", day: "numeric" });
  } catch { return key; }
}
// The free hours in a day that don't already have a task sitting in them.
function freeHours(dayItems) {
  const occupied = new Set(
    dayItems.map((tk) => timeToMinutes(tk.time)).filter((m) => m != null).map((m) => Math.floor(m / 60))
  );
  const free = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) {
    if (!occupied.has(h)) free.push(h * 60);
  }
  return free;
}

export default function Page() {
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLang] = useState("uk");
  const [view, setView] = useState("today");
  const [filterPriorities, setFilterPriorities] = useState(new Set());
  const [filterTags, setFilterTags] = useState(new Set());
  const [openTaskId, setOpenTaskId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragPointer, setDragPointer] = useState(null); // {x, y} in viewport coords
  const [dragOverKey, setDragOverKey] = useState(null);  // "dateKey|free|minutes" or "dateKey|task|id"
  const draggingTaskRef = useRef(null); // the task object being dragged, for the floating ghost label
  const lastPointerRef = useRef({ x: 0, y: 0 }); // latest pointer position, kept even while finger is still
  const dragOverKeyRef = useRef(null); // mirrors dragOverKey, readable inside the scroll loop
  const recognitionRef = useRef(null);
  const t = T[lang] || T.en;

  // How close to the top/bottom edge of the screen (in px) triggers
  // auto-scroll, and how fast that scroll moves -- tuned for a phone-sized
  // viewport where a whole week of days doesn't fit on screen at once.
  const SCROLL_EDGE = 90;
  const SCROLL_SPEED = 14;

  function updateDragOverFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const dropEl = el && el.closest ? el.closest("[data-drop-key]") : null;
    const key = dropEl ? dropEl.getAttribute("data-drop-key") : null;
    if (key !== dragOverKeyRef.current) {
      dragOverKeyRef.current = key;
      setDragOverKey(key);
    }
  }

  function handleDragStart(e, tk, dateKeyOfTask) {
    e.preventDefault();
    draggingTaskRef.current = tk;
    setDraggingId(tk.id);
    setDragPointer({ x: e.clientX, y: e.clientY });
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    dragOverKeyRef.current = null;
    setDragOverKey(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }

  function handleDragMove(e) {
    if (!draggingId) return;
    e.preventDefault();
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setDragPointer({ x: e.clientX, y: e.clientY });
    updateDragOverFromPoint(e.clientX, e.clientY);
  }

  function handleDragEnd() {
    if (draggingId && dragOverKeyRef.current) {
      const [dateKey, kind, val] = dragOverKeyRef.current.split("|");
      if (kind === "free") dropOnFreeHour(dateKey, draggingId, Number(val));
      else if (kind === "task" && val !== draggingId) dropOnTask(dateKey, draggingId, val);
    }
    draggingTaskRef.current = null;
    dragOverKeyRef.current = null;
    setDraggingId(null);
    setDragPointer(null);
    setDragOverKey(null);
  }

  // Auto-scrolls the page while a finger/cursor is held near the top or
  // bottom edge during a drag -- essential on mobile, where a whole week
  // of days is usually taller than the screen. Keeps the highlighted drop
  // target in sync as the page scrolls underneath a stationary pointer.
  useEffect(() => {
    if (!draggingId) return;
    let rafId;
    function tick() {
      const { x, y } = lastPointerRef.current;
      const vh = window.innerHeight;
      if (y < SCROLL_EDGE) {
        window.scrollBy(0, -SCROLL_SPEED * (1 - y / SCROLL_EDGE));
      } else if (y > vh - SCROLL_EDGE) {
        window.scrollBy(0, SCROLL_SPEED * (1 - (vh - y) / SCROLL_EDGE));
      }
      updateDragOverFromPoint(x, y);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [draggingId]);

  useEffect(() => {
    setTasks(loadTasks());
    const savedLang = typeof window !== "undefined" && window.localStorage.getItem(LANG_STORAGE_KEY);
    const initialLang = savedLang === "en" ? "en" : "uk";
    setLang(initialLang);

    const SpeechRecognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = LANGUAGES[initialLang].code;
      rec.onresult = (event) => {
        let finalChunk = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript + " ";
        }
        if (finalChunk) setText((prev) => (prev ? prev + " " : "") + finalChunk.trim());
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recognitionRef.current = rec;
    }
  }, []);

  function switchLang(key) {
    setLang(key);
    try { window.localStorage.setItem(LANG_STORAGE_KEY, key); } catch {}
    if (recognitionRef.current) {
      recognitionRef.current.lang = LANGUAGES[key].code;
      if (listening) { recognitionRef.current.stop(); setListening(false); }
    }
  }

  function toggleListening() {
    if (!recognitionRef.current) {
      setError(lang === "uk" ? "Голосовий ввід не підтримується цим браузером." : "Voice input isn't supported in this browser.");
      return;
    }
    if (listening) { recognitionRef.current.stop(); setListening(false); }
    else { setError(""); recognitionRef.current.start(); setListening(true); }
  }

  async function structureIt() {
    if (!text.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, now: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const newTasks = (data.tasks || []).map((tk) => ({
        ...tk, id: crypto.randomUUID(), done: false, notes: "", subtasks: [],
        tags: tk.tags || [], difficulty: tk.difficulty || "medium",
      }));
      const merged = [...tasks, ...newTasks];
      setTasks(merged); saveTasks(merged); setText("");
    } catch (e) {
      setError(e.message || "Something went wrong parsing that.");
    } finally { setBusy(false); }
  }

  function updateTask(id, patchObj) {
    setTasks((prev) => {
      const merged = prev.map((tk) => (tk.id === id ? { ...tk, ...patchObj } : tk));
      saveTasks(merged); return merged;
    });
  }
  function replaceTask(fullTask) { updateTask(fullTask.id, fullTask); }
  function removeTask(id) {
    setTasks((prev) => { const merged = prev.filter((tk) => tk.id !== id); saveTasks(merged); return merged; });
    setOpenTaskId(null);
  }
  function toggleDone(id) {
    setTasks((prev) => {
      const merged = prev.map((tk) => (tk.id === id ? { ...tk, done: !tk.done } : tk));
      saveTasks(merged); return merged;
    });
  }
  function clearAll() { setTasks([]); saveTasks([]); }

  // Drop a task onto a free hour: it simply takes that exact time. The day
  // it came from (if different) gets its gap closed.
  function dropOnFreeHour(dateKey, draggedId, minutes) {
    setTasks((prev) => {
      const dragged = prev.find((tk) => tk.id === draggedId);
      if (!dragged) return prev;
      const sourceKey = groupKey(dragged);
      const moved = {
        ...dragged,
        deadline: dateKey === "unscheduled" ? null : dateKey,
        time: minutesToHHMM(minutes),
      };
      const destOthers = prev.filter((tk) => groupKey(tk) === dateKey && tk.id !== draggedId);
      const rest = prev.filter((tk) => tk.id !== draggedId && groupKey(tk) !== dateKey && groupKey(tk) !== sourceKey);

      if (sourceKey === dateKey) {
        const merged = [...rest, ...destOthers, moved];
        saveTasks(merged); return merged;
      }
      const sourceRemaining = prev.filter((tk) => groupKey(tk) === sourceKey && tk.id !== draggedId);
      const merged = [...rest, ...reflowDay(sourceRemaining), ...destOthers, moved];
      saveTasks(merged); return merged;
    });
  }

  // Drop a task directly onto another task: dragged takes its exact time,
  // and that task (plus everything after it that day) shifts later.
  function dropOnTask(dateKey, draggedId, targetId) {
    setTasks((prev) => {
      const dragged = prev.find((tk) => tk.id === draggedId);
      if (!dragged) return prev;
      const sourceKey = groupKey(dragged);
      const destSorted = sortByTime(prev.filter((tk) => groupKey(tk) === dateKey && tk.id !== draggedId));
      const targetIdx = destSorted.findIndex((tk) => tk.id === targetId);
      if (targetIdx === -1) return prev;

      const targetStart = timeToMinutes(destSorted[targetIdx].time) ?? 8 * 60;
      const moved = { ...dragged, deadline: dateKey === "unscheduled" ? null : dateKey, time: minutesToHHMM(targetStart) };
      const withMoved = [...destSorted.slice(0, targetIdx), moved, ...destSorted.slice(targetIdx)];

      let cursor = targetStart + (moved.duration_minutes || 30);
      const retimedDest = withMoved.map((tk, i) => {
        if (i <= targetIdx) return tk;
        const start = cursor;
        cursor = start + (tk.duration_minutes || 30);
        return { ...tk, time: minutesToHHMM(start) };
      });

      const rest = prev.filter((tk) => tk.id !== draggedId && groupKey(tk) !== dateKey && groupKey(tk) !== sourceKey);
      if (sourceKey === dateKey) {
        const merged = [...rest, ...retimedDest];
        saveTasks(merged); return merged;
      }
      const sourceRemaining = prev.filter((tk) => groupKey(tk) === sourceKey && tk.id !== draggedId);
      const merged = [...rest, ...reflowDay(sourceRemaining), ...retimedDest];
      saveTasks(merged); return merged;
    });
  }

  function autoPlanMornings() {
    const todayStr = toISODate(new Date());
    const MORNING_START = 8 * 60, MORNING_END = 12 * 60, WINDOW = MORNING_END - MORNING_START;
    setTasks((prev) => {
      // Any not-done, high-priority (or high-difficulty) task due today or
      // with no date gets pulled into the morning -- regardless of whether
      // it already had some other time set. (Previously this required
      // !tk.time, which meant almost nothing ever qualified, since most
      // tasks get a time from the AI parse or from dragging.)
      const candidates = prev.filter(
        (tk) => !tk.done && (tk.difficulty === "high" || tk.priority === "high") && (tk.deadline === todayStr || !tk.deadline)
      );
      if (!candidates.length) return prev;
      const others = prev.filter((tk) => !candidates.includes(tk));
      const rawDurations = candidates.map((tk) => tk.duration_minutes || 45);
      const total = rawDurations.reduce((a, b) => a + b, 0);
      const scale = total > WINDOW ? WINDOW / total : 1;
      let cursor = MORNING_START;
      const scheduled = candidates.map((tk, i) => {
        const dur = Math.max(10, Math.round(rawDurations[i] * scale));
        const start = Math.min(cursor, MORNING_END - dur);
        cursor = start + dur;
        return { ...tk, time: minutesToHHMM(start), deadline: todayStr };
      });
      const merged = [...others, ...scheduled];
      saveTasks(merged); return merged;
    });
  }

  const todayStr = toISODate(new Date());
  const weekKeys = Array.from({ length: 7 }, (_, i) => toISODate(addDays(new Date(), i)));
  const allTags = Array.from(new Set(tasks.flatMap((tk) => tk.tags || [])));

  function inView(tk) {
    const key = groupKey(tk);
    if (view === "today") return key === todayStr || key === "unscheduled";
    return weekKeys.includes(key) || key === "unscheduled";
  }
  function passesFilters(tk) {
    if (filterPriorities.size && !filterPriorities.has(tk.priority)) return false;
    if (filterTags.size && !(tk.tags || []).some((tag) => filterTags.has(tag))) return false;
    return true;
  }

  const visible = tasks.filter((tk) => inView(tk) && passesFilters(tk));
  const groups = {};
  for (const tk of visible) {
    const key = groupKey(tk);
    if (!groups[key]) groups[key] = [];
    groups[key].push(tk);
  }
  if (view === "week") {
    for (const key of weekKeys) if (!groups[key]) groups[key] = [];
  }
  for (const key of Object.keys(groups)) groups[key] = sortByTime(groups[key]);
  const orderedKeys = Object.keys(groups).sort((a, b) => {
    if (a === "unscheduled") return 1;
    if (b === "unscheduled") return -1;
    return a.localeCompare(b);
  });

  function togglePriorityFilter(p) {
    setFilterPriorities((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  }
  function toggleTagFilter(tag) {
    setFilterTags((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }

  const openTask = tasks.find((tk) => tk.id === openTaskId);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div style={styles.headerTopRow}>
          <span style={styles.eyebrow}>ГОЛОС → РОЗКЛАД</span>
          <div style={styles.langSwitch}>
            {Object.keys(LANGUAGES).map((key) => (
              <button key={key} onClick={() => switchLang(key)}
                style={{ ...styles.langPill, background: lang === key ? "var(--paper)" : "transparent", color: lang === key ? "var(--ink)" : "var(--paper-dim)" }}>
                {LANGUAGES[key].label}
              </button>
            ))}
          </div>
        </div>
        <h1 style={styles.title}>Rail</h1>
      </header>

      <section style={styles.composer}>
        <textarea style={styles.textarea} rows={3} placeholder={t.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
        <div style={styles.composerRow}>
          <button onClick={toggleListening} aria-pressed={listening}
            style={{ ...styles.micButton, background: listening ? "var(--high)" : "var(--paper)", color: listening ? "var(--paper)" : "var(--ink)" }}>
            {listening ? t.listening : "\uD83C\uDF99 " + t.speak}
          </button>
          <button onClick={structureIt} disabled={busy || !text.trim()}
            style={{ ...styles.primaryButton, opacity: busy || !text.trim() ? 0.5 : 1 }}>
            {busy ? t.structuring : t.structure}
          </button>
        </div>
        {error && <p style={styles.errorText}>{error}</p>}
      </section>

      <div style={styles.tabRow}>
        <button onClick={() => setView("today")} style={{ ...styles.tab, ...(view === "today" ? styles.tabActive : {}) }}>{t.today}</button>
        <button onClick={() => setView("week")} style={{ ...styles.tab, ...(view === "week" ? styles.tabActive : {}) }}>{t.week}</button>
        {view === "today" && <button onClick={autoPlanMornings} style={styles.autoPlanButton}>{t.autoPlan}</button>}
      </div>

      <div style={styles.filterRow}>
        {["high", "medium", "low"].map((p) => (
          <button key={p} onClick={() => togglePriorityFilter(p)}
            style={{ ...styles.filterChip, borderColor: PRIORITY_COLOR[p], color: filterPriorities.has(p) ? "var(--ink)" : PRIORITY_COLOR[p], background: filterPriorities.has(p) ? PRIORITY_COLOR[p] : "transparent" }}>
            {PRIORITY_LABEL[lang][p]}
          </button>
        ))}
        {allTags.map((tag) => (
          <button key={tag} onClick={() => toggleTagFilter(tag)}
            style={{ ...styles.filterChip, borderColor: "var(--rail)", color: filterTags.has(tag) ? "var(--ink)" : "var(--paper-dim)", background: filterTags.has(tag) ? "var(--paper)" : "transparent" }}>
            #{tag}
          </button>
        ))}
      </div>

      <section style={styles.railSection}>
        {visible.length > 0 && (
          <div style={styles.railHeaderRow}>
            <span style={styles.railHeaderText}>{t.yourSchedule}</span>
            <button onClick={clearAll} style={styles.clearButton}>{t.clearAll}</button>
          </div>
        )}
        {tasks.length === 0 && <p style={styles.emptyState}>{t.empty}</p>}

        {orderedKeys.map((key) => {
          const dayItems = groups[key];
          const otherItems = draggingId ? dayItems.filter((tk) => tk.id !== draggingId) : dayItems;

          // While dragging, merge the day's tasks with its free hours into
          // one chronological list, so gaps show up right where they are
          // in the day rather than dumped in a separate block.
          const rows = draggingId
            ? [
                ...dayItems.map((tk) => ({ type: "task", minutes: timeToMinutes(tk.time) ?? 8 * 60, task: tk })),
                ...freeHours(otherItems).map((minutes) => ({ type: "free", minutes })),
              ].sort((a, b) => a.minutes - b.minutes)
            : dayItems.map((tk) => ({ type: "task", minutes: timeToMinutes(tk.time) ?? 8 * 60, task: tk }));

          return (
            <div key={key} style={styles.group}>
              <div style={styles.groupLabel}>{groupLabel(key, todayStr, lang)}</div>
              <div style={styles.rail}>
                {rows.length === 0 && (
                  <div style={styles.emptyDayHint}>{draggingId ? t.dropHere : t.noTasks}</div>
                )}

                {rows.map((row) => {
                  if (row.type === "free") {
                    const dropKey = `${key}|free|${row.minutes}`;
                    const isActive = dragOverKey === dropKey;
                    return (
                      <div key={"free-" + row.minutes}
                        data-drop-key={dropKey}
                        style={{ ...styles.freeSlot, ...(isActive ? styles.freeSlotActive : {}) }}
                      >
                        <span style={styles.freeSlotTime}>{minutesToHHMM(row.minutes)}</span>
                        <span style={styles.freeSlotLabel}>{t.free}</span>
                      </div>
                    );
                  }
                  const tk = row.task;
                  const isBeingDragged = draggingId === tk.id;
                  const dropKey = `${key}|task|${tk.id}`;
                  const isActive = draggingId && !isBeingDragged && dragOverKey === dropKey;
                  return (
                    <div key={tk.id}
                      data-drop-key={dropKey}
                      style={{ ...styles.item, opacity: isBeingDragged ? 0.35 : 1, ...(isActive ? styles.itemDropActive : {}) }}
                    >
                      <span
                        onPointerDown={(e) => handleDragStart(e, tk, key)}
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        style={styles.gripHandle}
                        aria-label="Drag to reschedule"
                      >
                        ⠿
                      </span>
                      <button onClick={() => toggleDone(tk.id)} aria-label="Toggle done"
                        style={{ ...styles.dot, background: tk.done ? "var(--paper-dim)" : (PRIORITY_COLOR[tk.priority] || "var(--paper-dim)"), border: "none", cursor: "pointer" }} />
                      <div style={styles.itemBody} onClick={() => setOpenTaskId(tk.id)}>
                        <div style={styles.itemTopRow}>
                          {tk.time && <span style={styles.time}>{tk.time}</span>}
                          <span style={{ ...styles.itemTitle, textDecoration: tk.done ? "line-through" : "none", opacity: tk.done ? 0.5 : 1 }}>{tk.title}</span>
                        </div>
                        <div style={styles.itemMeta}>
                          <span style={{ ...styles.priorityChip, color: PRIORITY_COLOR[tk.priority] || "var(--paper-dim)", borderColor: PRIORITY_COLOR[tk.priority] || "var(--paper-dim)" }}>
                            {PRIORITY_LABEL[lang][tk.priority] || tk.priority}
                          </span>
                          {tk.duration_minutes ? <span style={styles.metaText}>{tk.duration_minutes}m</span> : null}
                          {(tk.subtasks || []).length > 0 && (
                            <span style={styles.metaText}>{(tk.subtasks || []).filter((s) => s.done).length}/{(tk.subtasks || []).length}</span>
                          )}
                          {(tk.tags || []).map((tag) => (<span key={tag} style={styles.metaTag}>#{tag}</span>))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {openTask && (
        <TaskDetailSheet task={openTask} lang={lang} onChange={replaceTask} onClose={() => setOpenTaskId(null)} onDelete={removeTask} />
      )}

      {draggingId && dragPointer && draggingTaskRef.current && (
        <div
          style={{
            ...styles.dragGhost,
            left: dragPointer.x + 14,
            top: dragPointer.y + 14,
          }}
        >
          {draggingTaskRef.current.title}
        </div>
      )}
    </main>
  );
}

const styles = {
  main: { minHeight: "100dvh", padding: "env(safe-area-inset-top, 20px) 18px 32px", maxWidth: 560, margin: "0 auto" },
  header: { padding: "20px 2px 8px" },
  headerTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  langSwitch: { display: "flex", background: "var(--ink-raised)", borderRadius: 999, padding: 3, gap: 2 },
  langPill: { border: "none", borderRadius: 999, padding: "4px 12px", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 },
  eyebrow: { fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--paper-dim)" },
  title: { fontFamily: "var(--font-display)", fontSize: 40, margin: "4px 0 0", fontWeight: 700 },
  composer: { background: "var(--ink-raised)", borderRadius: 16, padding: 14, marginTop: 12 },
  textarea: { width: "100%", background: "transparent", border: "none", outline: "none", color: "var(--paper)", fontFamily: "var(--font-body)", fontSize: 16, resize: "vertical" },
  composerRow: { display: "flex", gap: 8, marginTop: 8 },
  micButton: { flex: "0 0 auto", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 600 },
  primaryButton: { flex: 1, border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 15, fontWeight: 600, background: "var(--low)", color: "var(--ink)" },
  errorText: { color: "var(--high)", fontSize: 13, marginTop: 8, marginBottom: 0 },
  tabRow: { display: "flex", gap: 8, marginTop: 22, alignItems: "center" },
  tab: { border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 14, fontWeight: 600, background: "transparent", color: "var(--paper-dim)" },
  tabActive: { background: "var(--paper)", color: "var(--ink)" },
  autoPlanButton: { marginLeft: "auto", border: "1px solid var(--rail)", borderRadius: 999, padding: "8px 14px", fontSize: 13, background: "transparent", color: "var(--paper)" },
  filterRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 },
  filterChip: { border: "1px solid", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontFamily: "var(--font-mono)" },
  railSection: { marginTop: 20 },
  railHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  railHeaderText: { fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "0.06em", color: "var(--paper-dim)", textTransform: "uppercase" },
  clearButton: { background: "none", border: "none", color: "var(--paper-dim)", fontSize: 13, textDecoration: "underline" },
  emptyState: { color: "var(--paper-dim)", fontSize: 14, lineHeight: 1.5 },
  emptyDayHint: { color: "var(--paper-dim)", fontSize: 12, fontStyle: "italic", padding: "8px 0 8px 12px", opacity: 0.6 },
  group: { marginBottom: 22 },
  groupLabel: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--paper-dim)", marginBottom: 8, paddingLeft: 20 },
  rail: { borderLeft: "2px solid var(--rail)", marginLeft: 6 },
  item: { display: "flex", gap: 10, padding: "10px 0 10px 12px", marginLeft: -7, cursor: "grab" },
  dot: { width: 12, height: 12, borderRadius: "50%", flex: "0 0 auto", marginTop: 4, padding: 0 },
  itemBody: { flex: 1, minWidth: 0 },
  itemTopRow: { display: "flex", alignItems: "baseline", gap: 8 },
  time: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--paper-dim)", flex: "0 0 auto" },
  itemTitle: { fontSize: 16, fontWeight: 500, flex: 1, minWidth: 0, overflowWrap: "break-word" },
  itemMeta: { display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" },
  priorityChip: { fontFamily: "var(--font-mono)", fontSize: 11, border: "1px solid", borderRadius: 999, padding: "1px 8px", textTransform: "uppercase" },
  metaText: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--paper-dim)" },
  metaTag: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--low)" },
  freeSlot: {
    display: "flex", alignItems: "center", gap: 8,
    minHeight: 40, padding: "0 0 0 12px", marginLeft: -7,
    border: "1px dashed var(--rail)", borderRadius: 8, marginBottom: 6,
  },
  freeSlotActive: {
    border: "1px dashed var(--low)", background: "rgba(76,154,139,0.16)",
  },
  freeSlotTime: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--paper-dim)" },
  freeSlotLabel: { fontSize: 11, color: "var(--paper-dim)", opacity: 0.6, fontStyle: "italic" },
  itemDropActive: {
    background: "rgba(76,154,139,0.14)", outline: "1px dashed var(--low)", borderRadius: 8,
  },
  gripHandle: {
    // 40px+ touch target per iOS/Android guidelines, even though the visible
    // glyph is small -- the padding does the work, not the font size.
    flex: "0 0 auto", width: 40, height: 40, display: "flex",
    alignItems: "center", justifyContent: "center",
    marginLeft: -8, marginTop: -8, marginRight: -6,
    color: "var(--paper-dim)", fontSize: 18, cursor: "grab",
    touchAction: "none", userSelect: "none",
    WebkitUserSelect: "none", WebkitTouchCallout: "none",
  },
  dragGhost: {
    position: "fixed", zIndex: 100, pointerEvents: "none",
    background: "var(--paper)", color: "var(--ink)", fontSize: 13, fontWeight: 600,
    padding: "6px 12px", borderRadius: 8, maxWidth: 220,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
  },
};
