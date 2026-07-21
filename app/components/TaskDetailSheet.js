"use client";

import { useState } from "react";

const PRIORITIES = ["high", "medium", "low"];
const PRIORITY_LABEL = {
  uk: { high: "високий", medium: "середній", low: "низький" },
  en: { high: "high", medium: "medium", low: "low" },
};
const PRIORITY_COLOR = { high: "var(--high)", medium: "var(--medium)", low: "var(--low)" };

const T = {
  uk: {
    title: "Назва", time: "Час", deadline: "Дедлайн", duration: "Тривалість (хв)",
    priority: "Пріоритет", tags: "Теги", addTag: "Додати тег…", notes: "Нотатки",
    notesPlaceholder: "Довільні нотатки до завдання…", subtasks: "Підзавдання",
    addSubtask: "Нове підзавдання…", delete: "Видалити завдання", close: "Готово",
    tool: "Рекомендований інструмент", toolPlaceholder: "напр. ChatGPT, Canva, Calendly…",
  },
  en: {
    title: "Title", time: "Time", deadline: "Deadline", duration: "Duration (min)",
    priority: "Priority", tags: "Tags", addTag: "Add tag…", notes: "Notes",
    notesPlaceholder: "Freeform notes about this task…", subtasks: "Subtasks",
    addSubtask: "New subtask…", delete: "Delete task", close: "Done",
    tool: "Recommended tool", toolPlaceholder: "e.g. ChatGPT, Canva, Calendly…",
  },
};

export default function TaskDetailSheet({ task, lang, onChange, onClose, onDelete }) {
  const [tagInput, setTagInput] = useState("");
  const [subtaskInput, setSubtaskInput] = useState("");
  const t = T[lang] || T.en;

  function patch(fields) {
    onChange({ ...task, ...fields });
  }

  function addTag() {
    const v = tagInput.trim();
    if (!v) return;
    patch({ tags: [...(task.tags || []), v] });
    setTagInput("");
  }

  function removeTag(tag) {
    patch({ tags: (task.tags || []).filter((x) => x !== tag) });
  }

  function addSubtask() {
    const v = subtaskInput.trim();
    if (!v) return;
    patch({
      subtasks: [...(task.subtasks || []), { id: crypto.randomUUID(), title: v, done: false }],
    });
    setSubtaskInput("");
  }

  function toggleSubtask(id) {
    patch({
      subtasks: (task.subtasks || []).map((s) => (s.id === id ? { ...s, done: !s.done } : s)),
    });
  }

  function removeSubtask(id) {
    patch({ subtasks: (task.subtasks || []).filter((s) => s.id !== id) });
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.handle} />

        <label style={styles.label}>{t.title}</label>
        <input
          style={styles.input}
          value={task.title}
          onChange={(e) => patch({ title: e.target.value })}
        />

        <div style={styles.row2}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>{t.time}</label>
            <input
              type="time"
              style={styles.input}
              value={task.time || ""}
              onChange={(e) => patch({ time: e.target.value || null })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>{t.deadline}</label>
            <input
              type="date"
              style={styles.input}
              value={task.deadline || ""}
              onChange={(e) => patch({ deadline: e.target.value || null })}
            />
          </div>
        </div>

        <label style={styles.label}>{t.duration}</label>
        <input
          type="number"
          min="0"
          style={styles.input}
          value={task.duration_minutes ?? ""}
          onChange={(e) =>
            patch({ duration_minutes: e.target.value ? Number(e.target.value) : null })
          }
        />

        <label style={styles.label}>{t.tool}</label>
        <input
          style={styles.input}
          placeholder={t.toolPlaceholder}
          value={task.suggested_tool || ""}
          onChange={(e) => patch({ suggested_tool: e.target.value || null })}
        />

        <label style={styles.label}>{t.priority}</label>
        <div style={styles.pillRow}>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => patch({ priority: p })}
              style={{
                ...styles.pill,
                background: task.priority === p ? PRIORITY_COLOR[p] : "transparent",
                color: task.priority === p ? "var(--ink)" : "var(--paper-dim)",
                borderColor: PRIORITY_COLOR[p],
              }}
            >
              {PRIORITY_LABEL[lang][p]}
            </button>
          ))}
        </div>

        <label style={styles.label}>{t.tags}</label>
        <div style={styles.pillRow}>
          {(task.tags || []).map((tag) => (
            <span key={tag} style={styles.tagChip}>
              {tag}
              <button onClick={() => removeTag(tag)} style={styles.chipX}>×</button>
            </span>
          ))}
        </div>
        <div style={styles.inlineAddRow}>
          <input
            style={styles.input}
            placeholder={t.addTag}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
          />
          <button onClick={addTag} style={styles.smallButton}>+</button>
        </div>

        <label style={styles.label}>{t.notes}</label>
        <textarea
          style={{ ...styles.input, minHeight: 70 }}
          placeholder={t.notesPlaceholder}
          value={task.notes || ""}
          onChange={(e) => patch({ notes: e.target.value })}
        />

        <label style={styles.label}>{t.subtasks}</label>
        {(task.subtasks || []).map((s) => (
          <div key={s.id} style={styles.subtaskRow}>
            <input
              type="checkbox"
              checked={s.done}
              onChange={() => toggleSubtask(s.id)}
            />
            <span style={{ flex: 1, textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.5 : 1 }}>
              {s.title}
            </span>
            <button onClick={() => removeSubtask(s.id)} style={styles.chipX}>×</button>
          </div>
        ))}
        <div style={styles.inlineAddRow}>
          <input
            style={styles.input}
            placeholder={t.addSubtask}
            value={subtaskInput}
            onChange={(e) => setSubtaskInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSubtask()}
          />
          <button onClick={addSubtask} style={styles.smallButton}>+</button>
        </div>

        <div style={styles.footerRow}>
          <button onClick={() => onDelete(task.id)} style={styles.deleteButton}>{t.delete}</button>
          <button onClick={onClose} style={styles.doneButton}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "flex-end", zIndex: 50,
  },
  sheet: {
    background: "var(--ink-raised)", width: "100%", maxHeight: "88vh",
    overflowY: "auto", borderRadius: "20px 20px 0 0", padding: "10px 18px 24px",
    margin: "0 auto", maxWidth: 560,
  },
  handle: {
    width: 40, height: 4, background: "var(--rail)", borderRadius: 999,
    margin: "6px auto 14px",
  },
  label: {
    display: "block", fontFamily: "var(--font-mono)", fontSize: 11,
    color: "var(--paper-dim)", marginTop: 14, marginBottom: 4, textTransform: "uppercase",
  },
  input: {
    width: "100%", background: "var(--ink)", border: "1px solid var(--rail)",
    borderRadius: 10, padding: "10px 12px", color: "var(--paper)",
    fontFamily: "var(--font-body)", fontSize: 15, outline: "none",
  },
  row2: { display: "flex", gap: 10 },
  pillRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  pill: {
    border: "1px solid", borderRadius: 999, padding: "5px 12px",
    fontSize: 13, fontFamily: "var(--font-mono)", textTransform: "uppercase",
  },
  tagChip: {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: "var(--ink)", border: "1px solid var(--rail)", borderRadius: 999,
    padding: "3px 6px 3px 10px", fontSize: 13, color: "var(--paper-dim)",
  },
  chipX: { background: "none", border: "none", color: "var(--paper-dim)", fontSize: 16, lineHeight: 1 },
  inlineAddRow: { display: "flex", gap: 6, marginTop: 6 },
  smallButton: {
    border: "none", borderRadius: 10, padding: "0 16px",
    background: "var(--low)", color: "var(--ink)", fontSize: 18, fontWeight: 700,
  },
  subtaskRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" },
  footerRow: { display: "flex", justifyContent: "space-between", marginTop: 22 },
  deleteButton: { background: "none", border: "none", color: "var(--high)", fontSize: 14 },
  doneButton: {
    background: "var(--paper)", color: "var(--ink)", border: "none",
    borderRadius: 10, padding: "10px 20px", fontWeight: 600, fontSize: 15,
  },
};
