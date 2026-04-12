import { Nav } from "@/components/nav";
import { PdfViewerProvider } from "@/components/pdf-viewer-context";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--surface)" }}>
      <Nav />
      <main className="flex-1 overflow-auto">
        <PdfViewerProvider>{children}</PdfViewerProvider>
      </main>
    </div>
  );
}
