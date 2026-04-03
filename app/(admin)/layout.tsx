import { Sidebar } from '@/components/Sidebar';

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem' }}>{children}</main>
    </div>
  );
}
