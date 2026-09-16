"use client";

import * as monaco from "monaco-editor";
import Editor, { loader, type EditorProps } from "@monaco-editor/react";

// 本地打包 Monaco，避免运行时依赖 jsdelivr CDN。
// 显式注册本地打包的 Web Worker，阻止 Monaco 回退到
// import.meta.url 默认加载逻辑（Turbopack 无法处理，会报错）。
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") {
      return new Worker(new URL("../lib/monaco/json.worker.ts", import.meta.url));
    }

    return new Worker(new URL("../lib/monaco/editor.worker.ts", import.meta.url));
  },
};

loader.config({ monaco });

export default function MonacoEditorInner(props: EditorProps) {
  return <Editor {...props} />;
}
