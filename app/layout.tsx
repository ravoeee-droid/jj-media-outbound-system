import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
  var APP_ROOTS = ['/dashboard', '/login', '/system', '/telegram', '/renderer-status'];
  var scope = function (value) {
    if (typeof value !== 'string' || value.charAt(0) !== '/') return value;
    if (value === BASE || value.indexOf(BASE + '/') === 0) return value;
    if (value.indexOf('/api/') === 0) return BASE + value;
    for (var i = 0; i < APP_ROOTS.length; i += 1) {
      var root = APP_ROOTS[i];
      if (value === root || value.indexOf(root + '/') === 0 || value.indexOf(root + '?') === 0 || value.indexOf(root + '#') === 0) return BASE + value;
    }
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
