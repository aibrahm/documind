import { Nav } from "@/components/nav";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen bg-white">
      <Nav />
      {children}
    </div>
  );
}
