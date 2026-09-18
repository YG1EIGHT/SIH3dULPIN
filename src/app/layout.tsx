import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "3D ULPIN - Vertical Property Mapping",
  description:
    "Convert 2D cadastral data into 3D vertical property structures.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}