import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JJ-Media Growth OS",
  description: "Outbound, CRM, personalisierte Social-Analysevideos und Growth Intelligence für JJ-Media.",
  robots: { index: false, follow: false },
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

const basePathBridge = `
(function () {
  var BASE = '/admin';
  var scope = function (value) {
    if (typeof value !== 'string' || !value.startsWith('/')) return value;
    if (value === BASE || value.startsWith(BASE + '/')) return value;
    if (value.startsWith('/api/')) return BASE + value;
    if (/^\/(dashboard|login|system|telegram|renderer-status)(\/|$|\?|#)/.test(value)) return BASE + value;
    return value;
  };
  if (!window.__jjAdminBasePathInstalled) {
    window.__jjAdminBasePathInstalled = true;
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return nativeFetch(typeof input === 'string' ? scope(input) : input, init);
    };
    ['pushState', 'replaceState'].forEach(function (method) {
      var nativeMethod = history[method].bind(history);
      history[method] = function (state, unused, url) {
        return nativeMethod(state, unused, typeof url === 'string' ? scope(url) : url);
      };
    });
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <script dangerouslySetInnerHTML={{ __html: basePathBridge }} />
        {children}
      </body>
    </html>
  );
}
