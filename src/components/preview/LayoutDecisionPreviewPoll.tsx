'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCopy, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Choice = {
  id: string
  label: string
  description: string
  recommended?: boolean
}

type Question = {
  id: string
  title: string
  subtitle: string
  choices: Choice[]
}

const questions: Question[] = [
  {
    id: 'hakone-hero',
    title: '1. Первый экран для Hakone',
    subtitle: 'Как должен ощущаться вход на страницу маршрута в Хаконэ.',
    choices: [
      { id: 'A', label: 'A — Тихий editorial-first экран', description: 'Один сдержанный пейзаж, сильный заголовок и аккуратная summary-панель.', recommended: true },
      { id: 'B', label: 'B — Сплит-экран 50/50', description: 'Изображение и summary-панель равноправны, подача более журнальная и очевидная.' },
      { id: 'C', label: 'C — Более кинематографичный scenic hero', description: 'Сильнее эмоция и пейзаж, но выше риск потерять decisional clarity.' },
    ],
  },
  {
    id: 'hakone-route',
    title: '2. Подача маршрута на Hakone',
    subtitle: 'Как визуально показывать логику поездки.',
    choices: [
      { id: 'A', label: 'A — Горизонтальная journey-strip логика', description: 'Tokyo → ascent → core Hakone → return / overnight. На мобильном превращается в главы.', recommended: true },
      { id: 'B', label: 'B — Вертикальные narrative chapters', description: 'Более спокойно и привычно, но меньше ощущения пути.' },
      { id: 'C', label: 'C — Список POI-карточек', description: 'Самый простой вариант, но он сильнее скатывается в catalogue feel.' },
    ],
  },
  {
    id: 'tokyo-hero',
    title: '3. Первый экран для Tokyo Day One',
    subtitle: 'Как должен ощущаться вход на флагманскую страницу первого дня в Токио.',
    choices: [
      { id: 'A', label: 'A — Плотный editorial hero с city-contrast настроением', description: 'Сильная типографика, urban collage / contrast feel и компактная summary-панель.', recommended: true },
      { id: 'B', label: 'B — Более спокойный text-first hero', description: 'Максимум ясности, минимум визуального давления, но может стать слишком сухо.' },
      { id: 'C', label: 'C — Большой image-led hero', description: 'Больше эмоции, но есть риск стать похожим на обычную tour-landing page.' },
    ],
  },
  {
    id: 'tokyo-route',
    title: '4. Подача маршрута на Tokyo Day One',
    subtitle: 'Как лучше показать город через последовательность контрастов.',
    choices: [
      { id: 'A', label: 'A — Alternating editorial chapter bands', description: 'Каждый район как отдельная глава с ритмом и сменой характера.', recommended: true },
      { id: 'B', label: 'B — Строгий вертикальный itinerary', description: 'Читабельно, но менее живо и менее premium.' },
      { id: 'C', label: 'C — Сетка district cards', description: 'Удобно сканировать, но хуже передаёт логику дня как последовательного опыта.' },
    ],
  },
  {
    id: 'tokyo-compare',
    title: '5. Нужен ли прямой блок сравнения на Tokyo Day One',
    subtitle: 'Стоит ли явно объяснять, чем этот маршрут лучше generic overview tour.',
    choices: [
      { id: 'A', label: 'A — Да, через split-comparison блок', description: 'Tasteful comparison: generic overview vs this route. Даёт сильное позиционирование.', recommended: true },
      { id: 'B', label: 'B — Только мягкое, непрямое отличие', description: 'Более элегантно, но слабее с точки зрения clarity.' },
      { id: 'C', label: 'C — Без comparison section', description: 'Самый чистый вариант, но часть позиции страницы останется неявной.' },
    ],
  },
  {
    id: 'hakone-additions',
    title: '6. Что делать с optional additions на Hakone',
    subtitle: 'Как подавать дополнительные варианты, чтобы они не ломали core route.',
    choices: [
      { id: 'A', label: 'A — Оставить тихим secondary shelf внизу', description: 'Гибкость сохраняется, но ядро страницы остаётся чистым.', recommended: true },
      { id: 'B', label: 'B — Встроить дополнения в основной маршрут', description: 'Глубже интеграция, но выше риск расползания логики.' },
      { id: 'C', label: 'C — Сильно сократить, оставить только 2–3 варианта', description: 'Чище и жёстче, но менее гибко для продажи ритма / overnight.' },
    ],
  },
]

const initialState = Object.fromEntries(questions.map((question) => [question.id, ''])) as Record<string, string>

export function LayoutDecisionPreviewPoll() {
  const [answers, setAnswers] = useState<Record<string, string>>(initialState)
  const [notes, setNotes] = useState('')
  const [copied, setCopied] = useState(false)

  const completedCount = useMemo(() => Object.values(answers).filter(Boolean).length, [answers])

  const summary = useMemo(() => {
    const lines = questions.map((question) => {
      const selectedId = answers[question.id]
      const selectedChoice = question.choices.find((choice) => choice.id === selectedId)
      return `- ${question.title}: ${selectedChoice ? selectedChoice.label : 'не выбрано'}`
    })

    const noteBlock = notes.trim() ? `\nДополнительно от Эдуарда:\n${notes.trim()}` : ''

    return ['Решения по layout fork для Hakone / Tokyo Day One:', ...lines, noteBlock].filter(Boolean).join('\n')
  }, [answers, notes])

  async function copySummary() {
    await navigator.clipboard.writeText(summary)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="min-h-screen bg-[#07101c] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_78%_0%,rgba(99,102,241,0.18),transparent_26%),radial-gradient(circle_at_50%_100%,rgba(15,118,110,0.12),transparent_30%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-white/10 bg-[#0b1623]/92 p-6 shadow-[0_28px_90px_rgba(3,8,20,0.28)] md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/16 bg-sky-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100">
                <Sparkles className="size-3.5" />
                Vercel review poll
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white md:text-5xl md:leading-[1.02]">
                Опрос по layout-развилкам для Hakone и Tokyo Day One
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-[15px]">
                Это review-only поверхность для выбора направления. Ничего не меняет на live-сайте. Выбери варианты, при желании добавь комментарий и скопируй итоговую сводку для LLoyd.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/16 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100">
              <CheckCircle2 className="size-3.5" />
              {completedCount} / {questions.length} выбрано
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="space-y-4">
            {questions.map((question) => (
              <article key={question.id} className="rounded-[28px] border border-white/10 bg-[#0b1623]/92 p-5 shadow-[0_18px_50px_rgba(3,8,20,0.22)]">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">{question.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{question.subtitle}</p>
                </div>

                <div className="space-y-3">
                  {question.choices.map((choice) => {
                    const isSelected = answers[question.id] === choice.id
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        onClick={() => setAnswers((current) => ({ ...current, [question.id]: choice.id }))}
                        className={cn(
                          'w-full rounded-[24px] border p-4 text-left transition-all',
                          isSelected
                            ? 'border-sky-300/35 bg-sky-300/[0.12] shadow-[0_0_0_1px_rgba(125,211,252,0.12)]'
                            : 'border-white/10 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-white">{choice.label}</span>
                              {choice.recommended ? (
                                <span className="rounded-full border border-emerald-300/16 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
                                  recommended
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-300">{choice.description}</p>
                          </div>
                          <div className={cn('mt-1 size-5 rounded-full border transition-all', isSelected ? 'border-sky-300 bg-sky-300 shadow-[0_0_0_4px_rgba(125,211,252,0.12)]' : 'border-white/18 bg-transparent')} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </article>
            ))}

            <section className="rounded-[28px] border border-white/10 bg-[#0b1623]/92 p-5 shadow-[0_18px_50px_rgba(3,8,20,0.22)]">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">7. Комментарий от тебя</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Можно коротко дописать ощущение словами: например, “Hakone хочу тише”, “Tokyo должен быть sharp”, “не уходим в luxury tone”.
              </p>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Любые уточнения, ограничения или настроение, которое нужно сохранить…"
                className="mt-4 min-h-32 w-full rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-sky-300/30 focus:bg-white/[0.055]"
              />
            </section>
          </section>

          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-[28px] border border-white/10 bg-[#091320]/96 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Сводка</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Когда всё выбрано, просто скопируй этот блок и отправь LLoyd. Этого достаточно, чтобы зафиксировать направление для Johny / Verter.
              </p>

              <div className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{summary}</pre>
              </div>

              <Button className="mt-4 h-11 w-full rounded-full bg-white text-[#07101c] hover:bg-white/90" onClick={copySummary}>
                <ClipboardCopy className="size-4" />
                {copied ? 'Скопировано' : 'Скопировать сводку'}
              </Button>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 text-sm leading-6 text-slate-300">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Базовая рекомендация</div>
              <p className="mt-2">
                Safe starting point сейчас — везде выбрать <span className="font-medium text-white">A</span>, а в комментарии отметить только то, где хочется больше тишины, больше строгости или меньше sales-tone.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}
