// Мгновенная обратная связь при переключении вкладок админки: тяжёлые
// вкладки (Обзор, Клиенты, Ресурсы, POI) собирают данные из Airtable на
// сервере, и до этого файла навигация выглядела как «зависание» — клик
// без какой-либо реакции на несколько секунд.
export default function AdminLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--adm-bg, #07101c)]">
      <div className="flex items-center gap-3 text-sm text-[var(--adm-text-3, #6b7a90)]">
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        Загрузка раздела…
      </div>
    </div>
  )
}
