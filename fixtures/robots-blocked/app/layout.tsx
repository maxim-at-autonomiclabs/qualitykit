export const metadata = {
  title: "Blocked Analytics",
  description: "Product analytics platform for SaaS teams",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
