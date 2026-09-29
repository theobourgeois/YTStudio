import { memo, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";
import { usePlayback } from "@/stores/playback";

/** `m:ss` or `m:ss.xx` in the assistant's text: clicking one moves the playhead there. */
const TIME_RE = /\b(\d{1,2}):([0-5]\d)(?:\.(\d{1,3}))?\b/g;
const SEEK_PREFIX = "#seek=";

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** Turns times in text into links to them (not inside links or code). */
function remarkTimes() {
  const visit = (node: MdNode) => {
    if (!node.children || node.type === "link" || node.type === "linkReference") return;
    node.children = node.children.flatMap((child): MdNode[] => {
      if (child.type !== "text" || !child.value) {
        visit(child);
        return [child];
      }
      const out: MdNode[] = [];
      let last = 0;
      for (const m of child.value.matchAll(TIME_RE)) {
        const seconds = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
        if (m.index > last) out.push({ type: "text", value: child.value.slice(last, m.index) });
        out.push({ type: "link", url: `${SEEK_PREFIX}${seconds}`, children: [{ type: "text", value: m[0] }] });
        last = m.index + m[0].length;
      }
      if (last === 0) return [child];
      if (last < child.value.length) out.push({ type: "text", value: child.value.slice(last) });
      return out;
    });
  };
  return (tree: MdNode) => visit(tree);
}

function Link({ href, children, ...props }: ComponentProps<"a">) {
  const time = href?.startsWith(SEEK_PREFIX) ? Number(href.slice(SEEK_PREFIX.length)) : null;
  // Past the end it's not a time in this video (e.g. the 9:16 aspect ratio).
  const inside = usePlayback((s) => time !== null && time <= s.duration + 0.5);
  if (time !== null) {
    if (!inside) return <>{children}</>;
    return (
      <button
        type="button"
        title="Go there"
        className="cursor-pointer font-medium text-brand tabular-nums underline decoration-brand/35 decoration-dotted underline-offset-3 hover:decoration-solid"
        onClick={() => {
          usePlayback.getState().pause();
          usePlayback.getState().seek(time);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <a {...props} href={href} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

const components: Components = {
  p: ({ node: _, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-muted-foreground" {...props} />,
  ol: ({ node: _, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-muted-foreground" {...props} />,
  li: ({ node: _, ...props }) => <li className="pl-0.5" {...props} />,
  h1: ({ node: _, ...props }) => <h3 className="mt-3 mb-1.5 text-[13px] font-semibold first:mt-0" {...props} />,
  h2: ({ node: _, ...props }) => <h3 className="mt-3 mb-1.5 text-[13px] font-semibold first:mt-0" {...props} />,
  h3: ({ node: _, ...props }) => <h3 className="mt-3 mb-1.5 text-[13px] font-semibold first:mt-0" {...props} />,
  strong: ({ node: _, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  a: ({ node: _, ...props }) => <Link {...props} />,
  blockquote: ({ node: _, ...props }) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...props} />,
  hr: () => <hr className="my-3" />,
  code: ({ node: _, className, ...props }) =>
    className ? (
      <code className={cn("font-mono text-[12px]", className)} {...props} />
    ) : (
      <code className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground" {...props} />
    ),
  pre: ({ node: _, ...props }) => <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/60 p-2.5 leading-relaxed" {...props} />,
  table: ({ node: _, ...props }) => (
    <div className="my-2 overflow-x-auto rounded-lg border">
      <table className="w-full text-[12px]" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => <th className="border-b bg-muted/50 px-2 py-1 text-left font-medium" {...props} />,
  td: ({ node: _, ...props }) => <td className="border-b px-2 py-1 align-top last:border-b-0" {...props} />,
};

const remarkPlugins = [remarkGfm, remarkTimes];

/** The assistant's Markdown, styled for the chat. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-relaxed break-words text-foreground/90">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
