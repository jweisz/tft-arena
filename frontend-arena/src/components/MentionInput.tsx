import React, { useState, useEffect, useRef } from "react";
import { apiJson } from "../lib/api";

interface Agent {
  id: number;
  name: string;
  role_description: string;
  is_active: boolean;
}

interface MentionInputProps {
  roomId: number;
  onSend: (text: string, mentions?: string[]) => void;
}

const toMentionSlug = (agentName: string) =>
  agentName
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const MentionInput: React.FC<MentionInputProps> = ({
  roomId,
  onSend,
}) => {
  const [showPopup, setShowPopup] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const mentionRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAgents = async () => {
      if (!roomId) {
        if (!cancelled) {
          setAgents([]);
        }
        return;
      }

      try {
        const data = await apiJson<Agent[]>(`/api/rooms/${roomId}/agents`);
        if (cancelled) {
          return;
        }

        setAgents(
          data
            .filter((a) => a.is_active)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) {
          setAgents([]);
        }
      }
    };

    void loadAgents();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!showPopup) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setShowPopup(false);
      setFilter("");
      mentionRangeRef.current = null;
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showPopup]);

  const filteredAgents = agents.filter((a) =>
    a.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const insertMention = (agentName: string) => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    let range: Range | null = null;

    if (selection?.rangeCount) {
      const currentRange = selection.getRangeAt(0);
      if (editorRef.current.contains(currentRange.startContainer)) {
        range = currentRange.cloneRange();
      }
    }

    if (!range && mentionRangeRef.current) {
      range = mentionRangeRef.current.cloneRange();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    if (!range) return;

    // Find the "@" and the filter text to replace it
    // This is a simplified approach: we assume the cursor is right after the filter text
    const node = range.startContainer;
    const offset = range.startOffset;

    // We need to find the "@" back from the current position
    const text = node.textContent || "";
    const atIndex = text.lastIndexOf("@", offset - 1);

    if (atIndex !== -1) {
      range.setStart(node, atIndex);
      range.setEnd(node, offset);
      range.deleteContents();
    }

    // Create the slug
    const slug = document.createElement("span");
    slug.className = "mention-slug";
    slug.contentEditable = "false";
    slug.dataset.agent = agentName;
    slug.innerText = `@${agentName}`;
    slug.style.backgroundColor = "var(--accent-color)";
    slug.style.color = "#fff";
    slug.style.padding = "2px 6px";
    slug.style.borderRadius = "4px";
    slug.style.margin = "0 2px";
    slug.style.fontWeight = "bold";
    slug.style.display = "inline-block";

    range.insertNode(slug);

    // Insert a space after the slug
    const space = document.createTextNode("\u00A0");
    range.setStartAfter(slug);
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);

    selection?.removeAllRanges();
    selection?.addRange(range);

    setShowPopup(false);
    setFilter("");
    mentionRangeRef.current = null;
    editorRef.current.focus();
  };

  const handleInput = () => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    const textBefore =
      range.startContainer.textContent?.substring(0, range.startOffset) || "";

    const match = textBefore.match(/@([^@]*)$/);
    if (match) {
      setFilter(match[1]);
      setShowPopup(true);
      setSelectedIndex(0);
      mentionRangeRef.current = range.cloneRange();
    } else {
      setShowPopup(false);
      mentionRangeRef.current = null;
    }
  };

  const insertPlainTextAtCursor = (text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plainText = e.clipboardData.getData("text/plain");
    if (!plainText) {
      return;
    }

    insertPlainTextAtCursor(plainText);
    handleInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showPopup) {
      if (filteredAgents.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowPopup(false);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredAgents.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredAgents[selectedIndex]) {
          insertMention(filteredAgents[selectedIndex].name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowPopup(false);
        setFilter("");
        mentionRangeRef.current = null;
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!editorRef.current) return;

    // Extract text and mentions
    let text = "";
    const mentionsSet = new Set<string>();

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.classList.contains("mention-slug")) {
          const name = el.dataset.agent;
          if (name) {
            text += `@${toMentionSlug(name)}`;
            mentionsSet.add(name);
          }
        } else {
          for (const child of Array.from(node.childNodes)) {
            walk(child);
          }
          if (
            el.tagName === "DIV" ||
            el.tagName === "BR" ||
            el.tagName === "P"
          ) {
            text += "\n";
          }
        }
      }
    };

    walk(editorRef.current);

    const cleanText = text.replace(/\u00A0/g, " ").trim();
    if (cleanText) {
      onSend(cleanText, Array.from(mentionsSet));
      editorRef.current.innerHTML = "";
      setShowPopup(false);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {showPopup && filteredAgents.length > 0 && (
        <div
          ref={popupRef}
          style={{
            position: "absolute",
            bottom: "100%",
            left: "0",
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: "8px",
            boxShadow: "0 -10px 25px rgba(0,0,0,0.5)",
            marginBottom: "8px",
            width: "240px",
            maxHeight: "400px",
            overflowY: "auto",
            zIndex: 1000,
            scrollbarWidth: "thin",
          }}
        >
          {filteredAgents.map((agent, i) => (
            <div
              key={agent.id}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(agent.name);
              }}
              style={{
                padding: "0.75rem",
                cursor: "pointer",
                backgroundColor:
                  i === selectedIndex ? "var(--bg-tertiary)" : "transparent",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                borderLeft:
                  i === selectedIndex
                    ? "3px solid var(--accent-color)"
                    : "3px solid transparent",
              }}
            >
              <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
                {agent.name}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        ref={editorRef}
        contentEditable={true}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          minHeight: "80px",
          maxHeight: "200px",
          overflowY: "auto",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-color)",
          padding: "0.75rem",
          borderRadius: "4px",
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "0.95rem",
          lineHeight: "1.5",
        }}
        data-placeholder="Type your thought… (@ to mention)"
      />

      <style>{`
        [contenteditable=true]:empty:before {
          content: attr(data-placeholder);
          color: var(--text-secondary);
          opacity: 0.5;
          pointer-events: none;
        }
        .mention-slug {
          user-select: none;
        }
      `}</style>
    </div>
  );
};
