"use client";
import dynamic from "next/dynamic";

// WebGL / window 相关，只在浏览器端渲染
const StoryPlayer = dynamic(() => import("@/components/story/StoryPlayer").then((m) => m.StoryPlayer), { ssr: false });

export function RenderClient(props: React.ComponentProps<typeof StoryPlayer>) {
  return (
    <div style={{ margin: 0, background: "#000", minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <StoryPlayer {...props} />
    </div>
  );
}
