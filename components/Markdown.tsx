// Tiny Markdown renderer for Jarvis's packages and results: headings, bullet/numbered lists, **bold**, paragraphs.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </>
  );
}

export default function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`my-2 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((it, i) => (
          <li key={i}>
            <Inline text={it} />
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="mb-1 mt-4 font-semibold text-accent first:mt-0">
          <Inline text={h[2]} />
        </h3>,
      );
    } else if (ul || ol) {
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(
        <p key={blocks.length} className="my-2">
          <Inline text={line} />
        </p>,
      );
    }
  }
  flush();
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
