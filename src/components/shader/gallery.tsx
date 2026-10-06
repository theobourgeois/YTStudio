/**
 * The shader editor's parts in the component gallery (`/gallery`): the code editor (CodeMirror, in the theme's
 * `--code-*` colours) with a shader that compiles, and one with a problem marked on its line, with their status.
 * Outside a video their typing goes nowhere: the gallery is for looking.
 */
import type { ReactNode } from "react";
import { DEFAULT_SHADER, type ShaderProblem } from "@shared/shader-code";
import type { GallerySection } from "@/gallery/types";
import { CodeEditor } from "./code-editor";
import { Status } from "./shader-window";

const BROKEN = `// @param glow number 0 1 0.75 "Glow"
vec4 effect(vec2 uv) {
  return vec4(oops * glow, 0.0, 0.0, 1.0);
}
`;
const PROBLEMS: ShaderProblem[] = [{ line: 3, message: "'oops': undeclared identifier" }];

function Editor({ code, problems, children }: { code: string; problems: ShaderProblem[]; children?: ReactNode }) {
  return (
    <div className="flex w-[560px] flex-col overflow-hidden rounded border text-xs">
      <div className="flex h-8 items-center border-b px-2">
        <Status problems={problems} />
      </div>
      <div className="h-56">
        <CodeEditor value={code} onChange={() => {}} problems={problems} label="Shader code" />
      </div>
      {children}
    </div>
  );
}

function ShaderEditors() {
  return (
    <div className="flex flex-wrap gap-4">
      <Editor code={DEFAULT_SHADER.code} problems={[]} />
      <Editor code={BROKEN} problems={PROBLEMS}>
        <p className="border-t px-2 py-1.5 text-destructive">Line 3: 'oops': undeclared identifier</p>
      </Editor>
    </div>
  );
}

export const SHADER_SECTIONS: GallerySection[] = [
  {
    id: "shader-editor",
    title: "Video: the shader editor's code (GLSL's colours, line numbers, a problem marked on its line) and its status",
    source: "components/shader/code-editor.tsx, shader-window.tsx",
    render: () => <ShaderEditors />,
  },
];
