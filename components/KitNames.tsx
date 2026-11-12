"use client";
// On a client's assistant (kit mode), every "Jarvis" in the interface (page titles, labels, help text) shows the
// assistant's own name instead. Text the owner types in inputs and text boxes is left alone.
import { useEffect } from "react";
import { useIdentity } from "@/lib/client/identity";

const SKIP = "TEXTAREA,INPUT,SCRIPT,STYLE,CODE,PRE";

export default function KitNames() {
  const idn = useIdentity();
  useEffect(() => {
    if (!idn.kit || !idn.assistant || idn.assistant === "Jarvis") return;
    const name = idn.assistant;
    const dotted = name.toUpperCase().split("").join(".") + ".";
    const swap = (s: string) =>
      s.replace(/J\.A\.R\.V\.I\.S\./g, dotted).replace(/\bJARVIS\b/g, name.toUpperCase()).replace(/\bJarvis\b/g, name);
    const fixNode = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP) || p.isContentEditable) return;
        const v = n.nodeValue ?? "";
        if (/Jarvis|JARVIS|J\.A\.R/.test(v)) n.nodeValue = swap(v);
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as Element;
      if (el.matches(SKIP.toLowerCase().split(",").join(","))) {
        for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a); if (v && /Jarvis/.test(v)) el.setAttribute(a, swap(v)); }
        return;
      }
      for (const a of ["placeholder", "aria-label", "title"]) { const v = el.getAttribute(a); if (v && /Jarvis/.test(v)) el.setAttribute(a, swap(v)); }
      el.childNodes.forEach(fixNode);
    };
    const fixTitle = () => { if (/Jarvis/.test(document.title)) document.title = swap(document.title); };
    fixNode(document.body);
    fixTitle();
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") fixNode(m.target);
        else if (m.type === "attributes") fixNode(m.target);
        else m.addedNodes.forEach(fixNode);
      }
      fixTitle();
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title"] });
    const head = new MutationObserver(fixTitle);
    head.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); head.disconnect(); };
  }, [idn.kit, idn.assistant]);
  return null;
}
