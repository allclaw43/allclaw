import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export const LOCALES = ['zh', 'en', 'ja', 'ko', 'de', 'fr'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'zh';

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
};

export function detectLocale(acceptLanguage: string): Locale {
  const preferred = acceptLanguage
    .split(',')
    .map(l => l.split(';')[0].trim().toLowerCase().slice(0, 2));
  for (const lang of preferred) {
    if (LOCALES.includes(lang as Locale)) return lang as Locale;
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  // Cookie takes priority, fallback to Accept-Language header
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLang = cookieStore.get('locale')?.value as Locale | undefined;
  const acceptLang = headerStore.get('accept-language') || '';
  const locale: Locale = (cookieLang && LOCALES.includes(cookieLang))
    ? cookieLang
    : detectLocale(acceptLang);

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
