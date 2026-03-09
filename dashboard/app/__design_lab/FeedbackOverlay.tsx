"use client";
import { useState, useCallback, useEffect } from "react";

interface Comment {
  id: string;
  variantId: string;
  elementDescription: string;
  selector: string;
  text: string;
  x: number;
  y: number;
}

interface Props {
  targetName: string;
}

export function FeedbackOverlay({ targetName }: Props) {
  const [mode, setMode] = useState<"idle" | "picking" | "commenting">("idle");
  const [comments, setComments] = useState<Comment[]>([]);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingElement, setPendingElement] = useState<{ selector: string; description: string; variantId: string } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [overallDirection, setOverallDirection] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const getVariantId = (el: HTMLElement): string => {
    let current: HTMLElement | null = el;
    while (current) {
      const variantAttr = current.getAttribute("data-variant");
      if (variantAttr) return variantAttr;
      current = current.parentElement;
    }
    return "unknown";
  };

  const getSelector = (el: HTMLElement): string => {
    if (el.id) return `#${el.id}`;
    if (el.getAttribute("data-testid"))
      return `[data-testid='${el.getAttribute("data-testid")}']`;
    const classes = Array.from(el.classList)
      .filter((c) => !c.startsWith("__"))
      .slice(0, 2)
      .join(".");
    return classes ? `.${classes}` : el.tagName.toLowerCase();
  };

  const getDescription = (el: HTMLElement): string => {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim().slice(0, 40) || "";
    return `${tag}${text ? ` with "${text}"` : ""}`;
  };

  const handlePageClick = useCallback(
    (e: MouseEvent) => {
      if (mode !== "picking") return;
      const target = e.target as HTMLElement;
      // Don't capture clicks on the overlay itself
      if (target.closest("[data-feedback-overlay]")) return;

      e.preventDefault();
      e.stopPropagation();

      const variantId = getVariantId(target);
      const selector = getSelector(target);
      const description = getDescription(target);

      setPendingPos({ x: e.clientX, y: e.clientY });
      setPendingElement({ selector, description, variantId });
      setMode("commenting");
    },
    [mode]
  );

  useEffect(() => {
    if (mode === "picking") {
      document.body.style.cursor = "crosshair";
      document.addEventListener("click", handlePageClick, true);
    } else {
      document.body.style.cursor = "";
      document.removeEventListener("click", handlePageClick, true);
    }
    return () => {
      document.body.style.cursor = "";
      document.removeEventListener("click", handlePageClick, true);
    };
  }, [mode, handlePageClick]);

  const saveComment = () => {
    if (!commentText.trim() || !pendingElement || !pendingPos) return;
    const comment: Comment = {
      id: `c${Date.now()}`,
      variantId: pendingElement.variantId,
      elementDescription: pendingElement.description,
      selector: pendingElement.selector,
      text: commentText.trim(),
      x: pendingPos.x,
      y: pendingPos.y,
    };
    setComments((prev) => [...prev, comment]);
    setCommentText("");
    setPendingPos(null);
    setPendingElement(null);
    setMode("picking"); // stay in picking mode for more comments
  };

  const formatFeedback = (): string => {
    const byVariant: Record<string, Comment[]> = {};
    comments.forEach((c) => {
      if (!byVariant[c.variantId]) byVariant[c.variantId] = [];
      byVariant[c.variantId].push(c);
    });

    const lines = [
      `## Design Lab Feedback`,
      ``,
      `**Target:** ${targetName}`,
      `**Comments:** ${comments.length}`,
      ``,
    ];

    Object.entries(byVariant).forEach(([variantId, variantComments]) => {
      lines.push(`### Variant ${variantId}`);
      variantComments.forEach((c, i) => {
        lines.push(
          `${i + 1}. **${c.elementDescription}** (\`${c.selector}\`)`,
          `   "${c.text}"`,
          ``
        );
      });
    });

    lines.push(`### Overall Direction`);
    lines.push(overallDirection || "(no overall direction provided)");

    return lines.join("\n");
  };

  const handleSubmit = () => {
    const text = formatFeedback();
    navigator.clipboard.writeText(text).catch(() => {});
    setSubmitted(true);
  };

  const cancelComment = () => {
    setCommentText("");
    setPendingPos(null);
    setPendingElement(null);
    setMode("picking");
  };

  return (
    <div data-feedback-overlay>
      {/* Floating action button */}
      {mode === "idle" && !showPanel && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg transition-all hover:scale-105"
          style={{
            backgroundColor: "#268bd2",
            color: "#fdf6e3",
          }}
        >
          <span>💬</span> Add Feedback
        </button>
      )}

      {/* Feedback panel */}
      {showPanel && mode === "idle" && (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-xl shadow-2xl p-4 w-80"
          style={{ backgroundColor: "#073642", border: "1px solid #586e75" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold" style={{ color: "#eee8d5" }}>
              Design Lab Feedback
            </span>
            <button
              onClick={() => setShowPanel(false)}
              className="text-xs"
              style={{ color: "#586e75" }}
            >
              ✕
            </button>
          </div>

          <p className="text-xs mb-3 leading-relaxed" style={{ color: "#839496" }}>
            Click "Pick Element" then click any element in a variant to add a comment.
          </p>

          <button
            onClick={() => { setMode("picking"); setShowPanel(false); }}
            className="w-full py-2 rounded-lg text-sm font-medium mb-3"
            style={{ backgroundColor: "#268bd2", color: "#fdf6e3" }}
          >
            Pick Element ({comments.length} comment{comments.length !== 1 ? "s" : ""})
          </button>

          {comments.length > 0 && (
            <>
              <div className="mb-3">
                <div className="text-xs mb-1.5" style={{ color: "#93a1a1" }}>
                  Overall Direction *
                </div>
                <textarea
                  value={overallDirection}
                  onChange={(e) => setOverallDirection(e.target.value)}
                  placeholder="e.g. Go with Variant B structure, apply Variant A's color scheme..."
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none"
                  style={{
                    backgroundColor: "#002b36",
                    border: "1px solid #586e75",
                    color: "#eee8d5",
                  }}
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={!overallDirection.trim()}
                className="w-full py-2 rounded-lg text-sm font-medium"
                style={{
                  backgroundColor: overallDirection.trim() ? "#859900" : "#586e75",
                  color: "#fdf6e3",
                  cursor: overallDirection.trim() ? "pointer" : "not-allowed",
                }}
              >
                Copy Feedback to Clipboard
              </button>
              {submitted && (
                <p className="text-xs mt-2 text-center" style={{ color: "#859900" }}>
                  ✓ Copied! Paste it in the terminal.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Picking mode overlay */}
      {mode === "picking" && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-sm font-medium flex items-center gap-3 shadow-xl"
          style={{ backgroundColor: "#073642", border: "1px solid #268bd2", color: "#eee8d5" }}
        >
          <span className="text-xs" style={{ color: "#268bd2" }}>
            ✦ Click any element to comment
          </span>
          <button
            onClick={() => { setMode("idle"); setShowPanel(true); }}
            className="text-xs px-2 py-0.5 rounded"
            style={{ backgroundColor: "#586e75", color: "#eee8d5" }}
          >
            Done
          </button>
        </div>
      )}

      {/* Comment dots on page */}
      {comments.map((comment, i) => (
        <div
          key={comment.id}
          className="fixed z-40 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow"
          style={{
            left: comment.x - 12,
            top: comment.y - 12,
            backgroundColor: "#268bd2",
            color: "#fdf6e3",
            pointerEvents: "none",
          }}
        >
          {i + 1}
        </div>
      ))}

      {/* Comment input modal */}
      {mode === "commenting" && pendingPos && pendingElement && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="rounded-xl shadow-2xl p-5 w-96"
            style={{ backgroundColor: "#073642", border: "1px solid #586e75" }}
          >
            <div className="text-xs mb-1" style={{ color: "#586e75" }}>
              Commenting on: <code style={{ color: "#2aa198" }}>{pendingElement.selector}</code>
              {" · "}
              <span style={{ color: "#268bd2" }}>Variant {pendingElement.variantId}</span>
            </div>
            <textarea
              autoFocus
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveComment();
                if (e.key === "Escape") cancelComment();
              }}
              placeholder="What do you think about this element?"
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none mt-2 mb-3"
              style={{
                backgroundColor: "#002b36",
                border: "1px solid #586e75",
                color: "#eee8d5",
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={saveComment}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: "#268bd2", color: "#fdf6e3" }}
              >
                Save (⌘↵)
              </button>
              <button
                onClick={cancelComment}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ backgroundColor: "#002b36", color: "#586e75", border: "1px solid #586e75" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
