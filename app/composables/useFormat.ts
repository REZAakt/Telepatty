import { formatMessageTime, formatDateSeparator, toPersianDigits, type DateOpts } from '~~/core/format'

/** Locale/date formatting honoring settings (jalali, persian digits). */
export const useFormat = () => {
  const settings = useSettingsStore()
  const locale = computed(() => (settings.language === 'fa' ? 'fa' : 'en'))
  const opts = computed<DateOpts>(() => ({
    locale: locale.value,
    jalali: settings.jalali,
    persianDigits: settings.persianDigits,
  }))
  const time = (ts: number) => formatMessageTime(ts, opts.value)
  const day = (ts: number) => formatDateSeparator(ts, opts.value)
  const digits = (s: string | number) => (settings.persianDigits ? toPersianDigits(String(s)) : String(s))
  const dir = computed(() => (settings.language === 'fa' ? 'rtl' : 'ltr'))
  return { locale, time, day, digits, dir }
}
