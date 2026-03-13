"use client";
import { useState } from "react";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/i18n";

export function LangSwitcher({ current }: { current: string }) {
  const [open, setOpen] = useState(false);

  function switchLang(locale: Locale) {
    document.cookie = `locale=${locale};path=/;max-age=31536000`;
    window.location.reload();
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
      >
        🌐 {LOCALE_LABELS[current as Locale] || current}
        <span className="text-gray-600">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-[#111827] border border-[#1e2d45] rounded-xl shadow-xl overflow-hidden min-w-[120px]">
            {LOCALES.map(locale => (
              <button
                key={locale}
                onClick={() => switchLang(locale)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition-colors flex items-center gap-2 ${
                  locale === current ? "text-blue-400 bg-blue-900/20" : "text-gray-300"
                }`}
              >
                {locale === current && <span>✓</span>}
                {LOCALE_LABELS[locale]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
