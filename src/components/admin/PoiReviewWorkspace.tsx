'use client'

/* Operate: extend the existing admin palette and shell. A searchable queue on
 * the left and one discussion on the right; save and advance is the main task.
 * Real batch data only. Phone layout opens one record, with an explicit way back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ExternalLink, MessageSquare, RefreshCw, Search } from 'lucide-react'
import { AdminShell } from './AdminShell'
import { REVIEW_STATUSES, REVIEW_DISPLAY_STATUSES, isReviewArchived, reviewDisplayStatus, reviewKey, reviewNeedsReplyAfter, reviewRowsForView, reviewStatusLabel, reviewViewFromSearch, type ReviewView, type ReviewEvent, type ReviewRow, type ReviewStatus } from '@/lib/poi-review'
import styles from './PoiReviewWorkspace.module.css'

const DRAFTS_KEY = 'jij-poi-review-drafts-v1'
const PENDING_KEY = 'jij-poi-review-pending-v1'
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
type Tab = ReviewView

function Status({ row }: { row: ReviewRow }) {
  return <span className={styles.status} data-status={row.status}>{reviewStatusLabel(row)}</span>
}

export function PoiReviewWorkspace() {
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<Tab>('queue')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [draftWarning, setDraftWarning] = useState('')
  const [writeFailure, setWriteFailure] = useState<{ key: string; kind: 'comment' | 'status'; status?: ReviewStatus; message: string } | null>(null)
  const pending = useRef<Record<string, string>>({})
  const loading = useRef(false)
  const saving = useRef(false)
  const mutationVersion = useRef(0)
  const composer = useRef<HTMLTextAreaElement>(null)
  const detailPanel = useRef<HTMLElement>(null)

  const refresh = useCallback(async () => {
    if (loading.current || saving.current) return
    const version = mutationVersion.current
    loading.current = true
    setRefreshing(true)
    try {
      const response = await fetch('/api/admin/poi-review', { cache: 'no-store' })
      if (response.status === 401) throw new Error('Сессия закончилась. Войдите в админку заново; черновик комментария останется на этом устройстве.')
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.rows)) throw new Error(data.error || 'Не удалось загрузить обсуждения')
      if (version !== mutationVersion.current) return
      setRows(data.rows)
      setError('')
    } catch (failure) {
      if (version === mutationVersion.current) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить список. Повторите попытку.')
    } finally {
      loading.current = false
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}')
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        setDrafts(Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith('japan-guide:') && typeof value === 'string')) as Record<string, string>)
      }
    } catch { setDraftWarning('Браузер не сохранил черновик. Отправляйте комментарий перед закрытием страницы.') }
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}')
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) pending.current = Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'string')) as Record<string, string>
    } catch { /* A new intent is persisted before its first POST. */ }
    const restoreLocation = () => {
      let fromHash = ''
      try { fromHash = reviewKey(decodeURIComponent(window.location.hash.slice(1))) } catch { /* Malformed deep links do not stop loading the queue. */ }
      setTab(reviewViewFromSearch(window.location.search))
      setSelected(fromHash)
      if (fromHash) setMobileDetail(true)
    }
    restoreLocation()
    void refresh()
    const focus = () => { if (document.visibilityState === 'visible') void refresh() }
    const interval = window.setInterval(focus, 60000)
    window.addEventListener('focus', focus)
    window.addEventListener('hashchange', restoreLocation)
    window.addEventListener('popstate', restoreLocation)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', focus)
      window.removeEventListener('hashchange', restoreLocation)
      window.removeEventListener('popstate', restoreLocation)
    }
  }, [refresh])

  const searched = useMemo(() => reviewRowsForView(rows ?? [], tab).filter(row => {
    const haystack = [row.sourceKey, row.nameRu, row.nameEn, row.problem, row.ownerDecision, ...row.history.map(e => e.text ?? '')].join(' ').toLocaleLowerCase('ru')
    return haystack.includes(query.trim().toLocaleLowerCase('ru'))
  }), [rows, tab, query])
  const visible = searched.filter(row => filter === 'all' || reviewDisplayStatus(row) === filter)
  const item = visible.find(row => row.sourceKey === selected) ?? visible[0]
  const archivedSelection = tab === 'queue' && (rows ?? []).find(row => row.sourceKey === selected && isReviewArchived(row))
  const position = visible.findIndex(row => row.sourceKey === item?.sourceKey)
  const draft = item ? drafts[item.sourceKey] ?? '' : ''
  const active = reviewRowsForView(rows ?? [], 'queue').length
  const archived = reviewRowsForView(rows ?? [], 'archive').length
  const replies = reviewRowsForView(rows ?? [], 'replies').length

  function updateLocation(view: Tab, key = '') {
    const url = new URL(window.location.href)
    if (view === 'queue') url.searchParams.delete('view')
    else url.searchParams.set('view', view)
    url.hash = key ? encodeURIComponent(key) : ''
    window.history.replaceState(null, '', url)
  }

  function select(row: ReviewRow) {
    setSelected(row.sourceKey)
    setMobileDetail(true)
    setNotice('')
    updateLocation(tab, row.sourceKey)
    detailPanel.current?.scrollTo({ top: 0 })
    if (window.matchMedia('(max-width: 740px)').matches) detailPanel.current?.scrollIntoView({ block: 'start' })
  }
  function changeView(next: { tab?: Tab; query?: string; filter?: string }) {
    if (next.tab !== undefined) { setTab(next.tab); setFilter('all') }
    if (next.query !== undefined) setQuery(next.query)
    if (next.filter !== undefined) setFilter(next.filter)
    setSelected('')
    updateLocation(next.tab ?? tab)
  }
  function storeDraft(key: string, value: string) {
    setDrafts(previous => {
      const next = { ...previous, [key]: value }
      try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(next)) }
      catch { setDraftWarning('Черновик не сохранён на устройстве. Отправьте комментарий перед закрытием страницы.') }
      return next
    })
    setNotice('')
  }
  async function save(kind: 'comment' | 'status', status?: ReviewStatus, advance = false) {
    if (!item || busy || (kind === 'comment' && !draft.trim())) return
    const target = item.sourceKey
    const intent = { sourceKey: target, kind, ...(kind === 'comment' ? { text: draft.trim() } : { status }) }
    const signature = JSON.stringify(intent)
    const id = pending.current[signature] ?? crypto.randomUUID()
    pending.current[signature] = id
    setBusy(true)
    saving.current = true
    mutationVersion.current += 1
    setNotice('')
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending.current))
      const response = await fetch('/api/admin/poi-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intent, id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось подтвердить сохранение. Повторите попытку.')
      const event = data.event as ReviewEvent
      if (event.id !== id || event.sourceKey !== target) throw new Error('Ответ не совпал с отправленным изменением')
      setRows(previous => previous?.map(row => row.sourceKey === target ? {
        ...row, status: event.status ?? row.status, needsAgentReply: reviewNeedsReplyAfter(row.needsAgentReply, event),
        history: row.history.some(e => e.id === event.id) ? row.history : [...row.history, event],
      } : row) ?? null)
      if (kind === 'comment') storeDraft(target, '')
      delete pending.current[signature]
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending.current)) } catch { /* A stale retry ID is safe; it resolves to the existing event. */ }
      setWriteFailure(null)
      setError('')
      setNotice(kind === 'comment' ? 'Комментарий сохранён. Агент увидит его в очереди.' : 'Статус сохранён.')
      if (advance && visible[position + 1]) select(visible[position + 1])
    } catch (failure) {
      setWriteFailure({ key: target, kind, status, message: failure instanceof Error ? failure.message : 'Не удалось сохранить. Текст оставлен в поле.' })
    } finally { saving.current = false; setBusy(false) }
  }
  async function exportQueue() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), rows }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'poi-review.json'; link.click()
    URL.revokeObjectURL(url)
  }

  return <div className={styles.root}><AdminShell currentPath="/admin/seo-llm" title="Разбор POI" subtitle="Japan Guide · решения, исправления и обсуждения" maxWidth="max-w-[1500px]"
    actions={<a href="/admin/seo-llm" className={styles.linkButton}>Все POI <ExternalLink size={15} /></a>}>
    <div className={styles.toolbar}>
      <p>{rows ? <><strong>{active}</strong> в работе <span>·</span> <strong>{archived}</strong> в архиве</> : 'Загружаю очередь…'}</p>
      <div className={styles.toolbarActions}>
        <button type="button" onClick={exportQueue} disabled={!rows}>Скачать список</button>
        <button type="button" onClick={refresh} disabled={refreshing || busy} aria-label="Обновить обсуждения"><RefreshCw size={15} className={refreshing ? styles.spin : ''} /> Обновить</button>
      </div>
    </div>
    {error && <div className={styles.error} role="alert">{error} <button onClick={refresh} type="button">Повторить</button></div>}
    {archivedSelection && <p className={styles.archiveNotice}>«{archivedSelection.nameRu}» — в архиве. <button type="button" onClick={() => { changeView({ tab: 'archive', query: '' }); setSelected(archivedSelection.sourceKey); updateLocation('archive', archivedSelection.sourceKey) }}>Открыть карточку</button></p>}
    <div className={styles.layout} data-detail={mobileDetail}>
      <aside className={styles.queue} aria-label="Очередь POI">
        <div className={styles.tabs} aria-label="Показать записи">
          {([['queue', 'В работе', rows ? active : '…'], ['replies', 'Ждут агента', replies], ['archive', 'Архив', rows ? archived : '…'], ['all', 'Все', rows?.length ?? '…']] as const).map(([key, label, count]) =>
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => changeView({ tab: key })}>{label} <span>{count}</span></button>)}
        </div>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={17} /><input aria-label="Найти POI" placeholder="Название, ключ или комментарий" value={query} onChange={e => changeView({ query: e.target.value })} /></label>
          <select aria-label="Фильтр по статусу" value={filter} disabled={!rows} onChange={e => changeView({ filter: e.target.value })}>
            <option value="all">Все статусы — {searched.length}</option>{Object.entries(REVIEW_DISPLAY_STATUSES).map(([key, label]) => {
              const count = searched.filter(row => reviewDisplayStatus(row) === key).length
              return <option key={key} value={key} disabled={count === 0}>{label} — {count}</option>
            })}
          </select>
        </div>
        <div className={styles.list}>
          {!rows && !error && <p className={styles.empty}>Загружаю карточки и комментарии…</p>}
          {rows && !visible.length && <div className={styles.empty}><strong>{tab === 'queue' && !query && filter === 'all' ? 'Рабочая очередь пуста' : 'Для выбранных фильтров карточек нет'}</strong><p>{tab === 'queue' && !query && filter === 'all' ? 'Завершённые и отложенные карточки сохранены в архиве.' : 'Измените запрос или сбросьте фильтры в этой вкладке.'}</p>{query || filter !== 'all' ? <button type="button" onClick={() => changeView({ query: '', filter: 'all' })}>Сбросить фильтры</button> : <button type="button" onClick={() => changeView({ tab: 'archive', query: '', filter: 'all' })}>Открыть архив</button>}</div>}
          {visible.map(row => <button key={row.sourceKey} type="button" className={styles.row} aria-pressed={item?.sourceKey === row.sourceKey} onClick={() => select(row)}>
            <div className={styles.rowTop}><span>{row.sourceKey.replace('japan-guide:', '')}</span>{row.needsAgentReply && <span className={styles.replyDot}>Ждёт агента</span>}</div>
            <strong>{row.nameRu}</strong>
            <span className={styles.rowSummary}>{row.problem}</span>
            <div className={styles.rowBottom}><Status row={row} />{row.history.some(e => e.kind === 'comment') && <span className={styles.commentCount}><MessageSquare size={13} /> {row.history.filter(e => e.kind === 'comment').length}</span>}</div>
          </button>)}
        </div>
        <p className={styles.queueFoot}>{visible.length} показано · комментарии хранятся в общей базе</p>
      </aside>
      <section ref={detailPanel} className={styles.detail} aria-label="Карточка и обсуждение">
        {item ? <>
          <div className={styles.detailNav}>
            <button className={styles.back} onClick={() => setMobileDetail(false)} type="button"><ArrowLeft size={16} /> К списку</button>
            <span>{position >= 0 ? `${position + 1} из ${visible.length}` : 'Карточка вне текущего фильтра'}</span>
            <div><button type="button" aria-label="Предыдущий POI" disabled={position <= 0 || busy} onClick={() => select(visible[position - 1])}><ArrowLeft size={17} /></button><button type="button" aria-label="Следующий POI" disabled={position < 0 || position >= visible.length - 1 || busy} onClick={() => select(visible[position + 1])}><ArrowRight size={17} /></button></div>
          </div>
          <div className={styles.detailBody} key={item.sourceKey}>
            <div className={styles.identity}><code>{item.sourceKey}</code><Status row={item} /></div>
            <h2>{item.nameRu}</h2><p className={styles.englishName}>{item.nameEn}</p>
            <div className={styles.sourceLinks}><a href={item.sourceUrl} target="_blank" rel="noreferrer">Страница Japan Guide <ExternalLink size={14} /></a>{item.googleUrl && <a href={item.googleUrl} target="_blank" rel="noreferrer">Ваша ссылка Google <ExternalLink size={14} /></a>}</div>
            <div className={styles.facts}><h3>{item.status === 'done' ? 'Результат' : 'Почему остановилось'}</h3><p>{item.problem}</p><h3>{item.needsAgentReply ? 'Агенту после вашего ответа' : 'Следующий шаг'}</h3>{item.needsAgentReply ? <p>Ваш комментарий сохранён ниже. Агент должен учесть его и обновить результат; повторно отвечать на прежний вопрос не нужно.</p> : <p>{item.nextStep}</p>}</div>
            {item.ownerDecision && <div className={styles.ownerDecision}><Check size={18} /><div><strong>Ваше решение уже учтено</strong><p>{item.ownerDecision}</p></div></div>}
            <div className={styles.statusControl}><label htmlFor="review-status">Изменить статус</label><select id="review-status" value="" disabled={busy} onChange={e => void save('status', e.target.value as ReviewStatus)}><option value="" disabled>Выбрать статус…</option>{Object.entries(REVIEW_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <form className={styles.composer} onSubmit={e => { e.preventDefault(); void save('comment') }}>
              <label htmlFor="review-comment">Ваш комментарий или решение</label>
              <textarea ref={composer} id="review-comment" value={draft} disabled={busy} maxLength={10000} placeholder="Что уточнить или исправить? Можно добавить ссылку на нужное место." onChange={e => storeDraft(item.sourceKey, e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save('comment') } }} />
              {writeFailure?.key === item.sourceKey && <div className={styles.error} role="alert">{writeFailure.message} <button type="button" disabled={busy} onClick={() => void save(writeFailure.kind, writeFailure.status)}>Повторить сохранение</button></div>}
              <div className={styles.composeActions}><button className={styles.primary} type="submit" disabled={busy || !draft.trim()}>{busy ? 'Сохраняю…' : 'Сохранить комментарий'}</button><button type="button" disabled={busy || !draft.trim() || position < 0 || position >= visible.length - 1} onClick={() => void save('comment', undefined, true)}>Сохранить и следующая <ArrowRight size={15} /></button></div>
              <p className={styles.draftHint}>{draftWarning || (draft ? 'Черновик на этом устройстве. Нажмите «Сохранить», чтобы передать агенту.' : 'Комментарии видны на всех устройствах. ⌘ / Ctrl + Enter — сохранить.')}</p>
              <p className={styles.notice} role="status" aria-live="polite">{notice}</p>
            </form>
            <div className={styles.history}><h3>Обсуждение <span>{item.history.filter(e => e.kind === 'comment').length}</span></h3>
              {!item.history.length && <p className={styles.historyEmpty}>Здесь появятся ваши комментарии, ответы агента и изменения статуса.</p>}
              {[...item.history].reverse().map(event => <article key={event.id} className={styles.event}><div><strong>{event.actor === 'owner' ? 'Вы' : 'Агент'}</strong><time dateTime={event.at}>{dateFormat.format(new Date(event.at))} · Япония</time></div><p>{event.kind === 'comment' ? event.text : event.kind === 'status' ? `Статус: ${REVIEW_STATUSES[event.status!]}` : 'Обновлены причина остановки и следующий шаг.'}</p></article>)}
            </div>
            <p className={styles.scopeNote}>Это рабочее обсуждение импорта. Регистрацию и исправление POI агент выполняет после проверок.</p>
          </div>
        </> : <div className={styles.empty}><MessageSquare size={28} /><h2>Выберите POI слева</h2><p>Причина остановки, ваши решения и обсуждение будут здесь.</p></div>}
      </section>
    </div>
  </AdminShell></div>
}
