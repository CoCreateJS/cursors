/*
 * Copyright (C) 2023 CoCreate and Contributors.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Commercial licensing information: https://CoCreateJS.com/licenses/
 */
import { getSelectionRects } from "@cocreate/utils/selection";

const editors = new Set();
const sameField = (a, b) => ["array", "object", "key"].every(name => a[name] === b[name]);
const sender = data => JSON.stringify([data.clientId, data.frameId]);
const box = (a, b) => {
    const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
    const right = Math.min(a.left + a.width, b.right);
    const bottom = Math.min(a.top + a.height, b.bottom);
    return right >= left && bottom > top
        ? { left, top, width: right - left, height: bottom - top } : null;
};
function mark(doc, root, rect, color, caret = false, name = "") {
    if (!rect) return;
    const node = doc.createElement("div");
    Object.assign(node.style, {
        position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${caret ? 2 : rect.width}px`, height: `${rect.height}px`,
        backgroundColor: color, opacity: caret ? "1" : "0.22"
    });
    if (caret && name) {
        const label = doc.createElement("span");
        label.textContent = name;
        Object.assign(label.style, {
            position: "absolute", bottom: "100%", left: "0", padding: "2px 4px",
            font: "11px sans-serif", whiteSpace: "nowrap", color: "white",
            backgroundColor: color, borderRadius: "2px"
        });
        node.append(label);
    }
    root.append(node);
}
function draw(record) {
    const { element, root, positions } = record;
    root.replaceChildren();
    if (!element.isConnected || element.getAttribute("crdt") !== "true" ||
        element.getAttribute("cursors") === "false") return;
    const snapshot = record.getSelections?.();
    if (snapshot) {
        positions.clear();
        for (const entry of snapshot)
            if (entry.socketId && entry.resolved) positions.set(sender(entry), entry);
    }
    const doc = element.ownerDocument, field = element.getBoundingClientRect();
    const viewport = { left: 0, top: 0, right: doc.documentElement.clientWidth,
        bottom: doc.documentElement.clientHeight };
    let clip = box({ left: field.left, top: field.top, width: field.width, height: field.height }, viewport);
    if (!clip) return;
    clip = { ...clip, right: clip.left + clip.width, bottom: clip.top + clip.height };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = doc.defaultView.getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
            clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right);
        }
        if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
            clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom);
        }
    }
    for (const data of positions.values()) {
        try {
            const resolved = record.resolve(data.resolved);
            const geometry = getSelectionRects(
                element, resolved.anchor, resolved.head, record.getRange
            );
            const frame = element.tagName === "IFRAME";
            const scaleX = frame ? field.width / (element.offsetWidth || field.width) : 1;
            const scaleY = frame ? field.height / (element.offsetHeight || field.height) : 1;
            const translate = rect => frame ? {
                left: field.left + (element.clientLeft + rect.left) * scaleX,
                top: field.top + (element.clientTop + rect.top) * scaleY,
                width: rect.width * scaleX, height: rect.height * scaleY
            } : rect;
            const color = data.presence?.background || data.presence?.color || "#6366f1";
            if (resolved.anchor !== resolved.head)
                for (const rect of geometry.selection) mark(doc, root, box(translate(rect), clip), color);
            mark(doc, root, box(translate(geometry.caret), clip), color, true,
                String(data.presence?.userName || data.clientId || ""));
        } catch {
            // Invalid positions and navigating iframes are retried on refresh.
        }
    }
}

/** Attach the lightweight remote cursor overlay to a live CRDT editor. */
export function attachEditorCursors(element, data, getRange, resolve = value => value, getSelections) {
    const doc = element.ownerDocument, view = doc.defaultView;
    const overlay = doc.createElement("div");
    overlay.setAttribute("data-editor-cursors", "");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const root = overlay.attachShadow({ mode: "closed" });
    doc.documentElement.append(overlay);
    const record = { element, data, root, getRange, resolve, getSelections, positions: new Map(), pending: null };
    const refresh = () => {
        if (record.pending !== null) return;
        record.pending = view.requestAnimationFrame(() => {
            record.pending = null;
            draw(record);
        });
    };
    record.refresh = refresh;
    editors.add(record);
    let inner;
    const watchDocument = () => {
        inner?.removeEventListener("scroll", refresh, true);
        inner?.defaultView?.removeEventListener("resize", refresh);
        inner = element.tagName === "IFRAME" ? element.contentDocument : null;
        inner?.addEventListener("scroll", refresh, true);
        inner?.defaultView?.addEventListener("resize", refresh);
        refresh();
    };
    const resize = new view.ResizeObserver(refresh);
    resize.observe(element);
    const attributes = new view.MutationObserver(refresh);
    attributes.observe(element, { attributes: true, attributeFilter: ["cursors", "class", "style"] });
    doc.addEventListener("scroll", refresh, true);
    view.addEventListener("resize", refresh);
    element.addEventListener("input", refresh);
    element.addEventListener("editor-source-change", refresh);
    element.addEventListener("editor-render", refresh);
    element.addEventListener("editor-document-change", watchDocument);
    watchDocument();
    const destroy = () => {
        editors.delete(record);
        if (record.pending !== null) view.cancelAnimationFrame(record.pending);
        resize.disconnect(); attributes.disconnect();
        doc.removeEventListener("scroll", refresh, true);
        view.removeEventListener("resize", refresh);
        inner?.removeEventListener("scroll", refresh, true);
        inner?.defaultView?.removeEventListener("resize", refresh);
        element.removeEventListener("input", refresh);
        element.removeEventListener("editor-source-change", refresh);
        element.removeEventListener("editor-render", refresh);
        element.removeEventListener("editor-document-change", watchDocument);
        overlay.remove();
    };
    return { refresh, destroy };
}

const editorCursors = new WeakMap();
window.addEventListener("cocreate-editor-cursor-init", ({ detail }) => {
    const { element, data, getRange, resolve, getSelections } = detail || {};
    if (!element || !data || typeof getRange !== "function" ||
        element.getAttribute("cursors") === "false") return;
    editorCursors.get(element)?.destroy();
    editorCursors.set(element, attachEditorCursors(
        element, data, getRange, resolve, getSelections
    ));
});
window.addEventListener("cocreate-editor-cursor-remove", ({ detail }) => {
    const element = detail?.element;
    editorCursors.get(element)?.destroy();
    editorCursors.delete(element);
});

window.addEventListener("cocreate-crdt-selection", ({ detail }) => {
    if (!detail?.socketId) return;
    const localFrame = window.CoCreate?.socket?.frameId;
    if (localFrame && detail.frameId === localFrame) return;
    for (const record of editors) {
        if (!sameField(record.data, detail)) continue;
        const id = sender(detail);
        if (detail.selection === null || !detail.resolved) record.positions.delete(id);
        else record.positions.set(id, detail);
        record.refresh();
    }
});

window.dispatchEvent(new Event("cocreate-editor-cursor-request"));

export default { attachEditorCursors };
