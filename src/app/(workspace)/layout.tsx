import { Nav } from "@/components/nav";
import { PdfViewerProvider } from "@/components/pdf-viewer-context";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "var(--surface)" }}
    >
      <Nav />
      {/*
        `flex flex-col min-h-0` matters: PdfViewerProvider wraps children
        in a `flex-1 flex` div that only sizes correctly when the parent
        is itself a flex container with constrained height. Without
        `flex-col + min-h-0`, every page inside the workspace ends up
        with natural height instead of filling the viewport — which on
        the document detail page meant the WHOLE page scrolled instead
        of the left pane scrolling internally, dragging the portaled
        PDF iframe out of view as the user scrolled chunks.
        Pages that need scrolling content (library, projects, settings,
        etc.) keep working because their content stretches the flex item
        to its natural height and `overflow-auto` here lets the workspace
        scroll. Pages that fill the viewport (doc detail, graph) use
        `h-full` to claim the available height exactly.
      */}
      <main className="flex flex-col flex-1 min-h-0 overflow-auto">
        <PdfViewerProvider>{children}</PdfViewerProvider>
      </main>
    </div>
  );
}
