'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { ArrowRight, CheckCircle2, Clock, AlertTriangle, Play, Pause, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PackageStatus = 'running' | 'blocked' | 'done'

export interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  required: boolean
}

export interface StallSignal {
  detectedAt: string
  reason: string
  severity: 'low' | 'medium' | 'high'
}

export interface OperationalPackage {
  id: string
  title: string
  status: PackageStatus
  currentStep: number // 1-5 arbitration loop
  checklist: ChecklistItem[]
  stallSignal?: StallSignal
  nextRecommendedAction: string
  startedAt: string
  updatedAt: string
  assignedTo: string
}

const ARBITRATION_STEPS = [
  { number: 1, title: 'Intake', desc: 'Capture request & context' },
  { number: 2, title: 'Assess', desc: 'Evaluate options & risks' },
  { number: 3, title: 'Arbitrate', desc: 'Weigh tradeoffs with doctrine' },
  { number: 4, title: 'Decide', desc: 'Commit to path forward' },
  { number: 5, title: 'Commit', desc: 'Lock & handoff for execution' },
]

const mockPackages: OperationalPackage[] = [
  {
    id: 'pkg-1',
    title: 'Meiji Shrine Spring Campaign',
    status: 'running',
    currentStep: 3,
    checklist: [
      { id: 'c1', text: 'Confirm venue availability', completed: true, required: true },
      { id: 'c2', text: 'Align with sponsor budget', completed: true, required: true },
      { id: 'c3', text: 'Secure photographer for 5-step loop assets', completed: false, required: true },
      { id: 'c4', text: 'Draft announcement copy', completed: false, required: false },
    ],
    stallSignal: {
      detectedAt: '2026-04-22T09:15:00Z',
      reason: 'Vendor confirmation pending >48h',
      severity: 'medium',
    },
    nextRecommendedAction: 'Send escalation note to partner',
    startedAt: '2026-04-18T08:00:00Z',
    updatedAt: '2026-04-23T06:30:00Z',
    assignedTo: 'Eduard',
  },
  {
    id: 'pkg-2',
    title: 'Golden Week Transport Coordination',
    status: 'blocked',
    currentStep: 2,
    checklist: [
      { id: 'c1', text: 'Map all route dependencies', completed: true, required: true },
      { id: 'c2', text: 'Validate capacity with JR', completed: false, required: true },
    ],
    nextRecommendedAction: 'Resolve capacity conflict',
    startedAt: '2026-04-20T10:00:00Z',
    updatedAt: '2026-04-22T14:20:00Z',
    assignedTo: 'Verter',
  },
  {
    id: 'pkg-3',
    title: 'Osaka Castle Night Illumination',
    status: 'done',
    currentStep: 5,
    checklist: [
      { id: 'c1', text: 'Complete arbitration loop', completed: true, required: true },
      { id: 'c2', text: 'All checklist items signed off', completed: true, required: true },
    ],
    nextRecommendedAction: 'Archive package',
    startedAt: '2026-04-10T09:00:00Z',
    updatedAt: '2026-04-21T17:45:00Z',
    assignedTo: 'Team',
  },
  {
    id: 'pkg-4',
    title: 'Kyoto Temple Partnership Renewal',
    status: 'running',
    currentStep: 4,
    checklist: [
      { id: 'c1', text: 'Legal review of terms', completed: true, required: true },
      { id: 'c2', text: 'Budget re-approval', completed: false, required: true },
    ],
    stallSignal: undefined,
    nextRecommendedAction: 'Finalize contract language',
    startedAt: '2026-04-19T11:00:00Z',
    updatedAt: '2026-04-23T02:10:00Z',
    assignedTo: 'Eduard',
  },
  {
    id: 'pkg-5',
    title: 'Hakone Onsen Media Kit',
    status: 'blocked',
    currentStep: 1,
    checklist: [],
    nextRecommendedAction: 'Gather initial requirements',
    startedAt: '2026-04-21T15:00:00Z',
    updatedAt: '2026-04-22T19:00:00Z',
    assignedTo: 'Samantha',
  },
]

export function MissionControlCommandCenter() {
  const [packages, setPackages] = useState<OperationalPackage[]>(mockPackages)
  const [selectedId, setSelectedId] = useState<string>('pkg-1')
  const [isTransitioning, setIsTransitioning] = useState(false)

  const selectedPackage = useMemo(() => 
    packages.find(p => p.id === selectedId) || packages[0], [packages, selectedId]
  )

  const activePackage = useMemo(() => 
    packages.find(p => p.status === 'running'), [packages]
  )

  const isChecklistComplete = useMemo(() => {
    if (!selectedPackage) return false
    const requiredItems = selectedPackage.checklist.filter(item => item.required)
    return requiredItems.length > 0 && requiredItems.every(item => item.completed)
  }, [selectedPackage])

  const updatePackage = useCallback((id: string, updates: Partial<OperationalPackage>) => {
    setPackages(prev => {
      let newPackages = prev.map(pkg => 
        pkg.id === id ? { ...pkg, ...updates, updatedAt: new Date().toISOString() } : pkg
      )

      // Enforcement: max 1 active (running) package
      const newRunning = newPackages.find(p => p.id === id && p.status === 'running')
      if (newRunning) {
        const currentRunning = newPackages.find(p => p.id !== id && p.status === 'running')
        if (currentRunning) {
          // Auto-block previous running when activating new one
          newPackages = newPackages.map(p => 
            p.id === currentRunning.id 
              ? { 
                  ...p, 
                  status: 'blocked' as const, 
                  stallSignal: {
                    detectedAt: new Date().toISOString(),
                    reason: `Superseded by ${newRunning.title}`,
                    severity: 'low'
                  },
                  nextRecommendedAction: 'Resume after current package completes'
                } 
              : p
          )
        }
      }

      // Enforcement: cannot mark done unless checklist complete
      const target = newPackages.find(p => p.id === id)
      if (target && updates.status === 'done' && !isChecklistCompleteForPackage(target)) {
        console.warn('Cannot complete: mandatory checklist items incomplete')
        return prev // rollback
      }

      return newPackages
    })
  }, [])

  const isChecklistCompleteForPackage = (pkg: OperationalPackage): boolean => {
    const required = pkg.checklist.filter(i => i.required)
    return required.length === 0 || required.every(i => i.completed)
  }

  const toggleChecklistItem = (pkgId: string, itemId: string) => {
    setPackages(prev => prev.map(pkg => {
      if (pkg.id !== pkgId) return pkg
      return {
        ...pkg,
        checklist: pkg.checklist.map(item => 
          item.id === itemId ? { ...item, completed: !item.completed } : item
        ),
        updatedAt: new Date().toISOString()
      }
    }))
  }

  const advanceArbitrationStep = (pkgId: string) => {
    setIsTransitioning(true)
    const pkg = packages.find(p => p.id === pkgId)
    if (!pkg) return

    const nextStep = Math.min(pkg.currentStep + 1, 5)
    updatePackage(pkgId, { currentStep: nextStep })

    setTimeout(() => setIsTransitioning(false), 420)
  }

  const setPackageStatus = (pkgId: string, newStatus: PackageStatus) => {
    if (newStatus === 'done') {
      const pkg = packages.find(p => p.id === pkgId)
      if (pkg && !isChecklistCompleteForPackage(pkg)) {
        alert('Cannot mark as DONE: Complete all required checklist items first.')
        return
      }
    }
    updatePackage(pkgId, { status: newStatus })
    if (newStatus === 'running' && selectedId !== pkgId) {
      setSelectedId(pkgId)
    }
  }

  const runningPackages = packages.filter(p => p.status === 'running')
  const blockedPackages = packages.filter(p => p.status === 'blocked')
  const donePackages = packages.filter(p => p.status === 'done')

  const formatTimeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
    return diffHrs > 0 ? `${diffHrs}h ago` : 'just now'
  }

  return (
    <div className="min-h-screen bg-[#05080f] text-white">
      {/* Top Utility Bar */}
      <header className="border-b border-white/10 bg-[#0a111d] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.125em] text-slate-500 font-medium">MISSION CONTROL</div>
              <div className="text-2xl font-semibold tracking-tighter">Command Center</div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2 px-4 py-1.5 bg-white/5 rounded-2xl border border-white/10">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-emerald-300">1 active • Doctrine enforced</span>
          </div>
          <button className="px-5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-sm transition flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Audit Log
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* LEFT RAIL: Navigation + Always-visible Active Package */}
        <div className="w-72 border-r border-white/10 bg-[#0a111d] flex flex-col">
          <div className="p-6 border-b border-white/10">
            <div className="uppercase text-xs tracking-[0.1em] text-slate-400 mb-4">OPERATIONS</div>
            <nav className="space-y-1">
              {['Dashboard', 'Packages', 'Arbitration', 'Resources', 'Reports'].map((label) => (
                <div key={label} className={cn(
                  "px-4 py-2.5 text-sm rounded-2xl flex items-center gap-3 cursor-pointer transition",
                  label === 'Packages' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-slate-400'
                )}>
                  {label === 'Packages' && <Play className="w-4 h-4" />}
                  {label}
                </div>
              ))}
            </nav>
          </div>

          {/* Prominent Active Package Status */}
          {activePackage && (
            <div className="p-6 border-b border-white/10">
              <div className="uppercase text-xs tracking-[0.1em] text-emerald-400 mb-3 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                CURRENTLY RUNNING
              </div>
              <div 
                onClick={() => setSelectedId(activePackage.id)}
                className="bg-[#111927] border border-emerald-500/30 rounded-3xl p-5 cursor-pointer hover:border-emerald-400/50 transition group"
              >
                <div className="font-semibold text-lg leading-tight mb-3 pr-8">{activePackage.title}</div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[10px] text-slate-500">STEP {activePackage.currentStep}/5</div>
                    <div className="text-emerald-400 text-sm font-medium">{ARBITRATION_STEPS[activePackage.currentStep-1]?.title}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Updated</div>
                    <div className="text-xs text-emerald-300/80">{formatTimeAgo(activePackage.updatedAt)}</div>
                  </div>
                </div>
                {activePackage.stallSignal && (
                  <div className="mt-4 text-[10px] bg-amber-500/10 border border-amber-400/30 text-amber-300 px-3 py-2 rounded-2xl flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div>{activePackage.stallSignal.reason}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-auto p-6 text-xs text-slate-500 border-t border-white/10">
            Single activity funnel enforced.<br />
            Max 1 running package.<br />
            Checklist gates DONE state.
          </div>
        </div>

        {/* CENTER: Kanban Board - 3 states only */}
        <div className="flex-1 p-8 overflow-auto bg-[#05080f]">
          <div className="max-w-[1200px] mx-auto">
            <div className="flex items-end justify-between mb-8">
              <div>
                <div className="text-emerald-400 text-xs font-mono tracking-[3px] mb-1">HIGH-SIGNAL OPERATIONS</div>
                <h1 className="text-5xl font-semibold tracking-tighter text-white">Activity Funnel</h1>
                <p className="text-slate-400 mt-3 max-w-md">One dominant surface. Doctrine-first. No generic SaaS patterns.</p>
              </div>
              <div className="text-right text-sm text-slate-400">
                {packages.length} packages • {runningPackages.length} running
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* RUNNING Column */}
              <div>
                <div className="flex items-center gap-3 mb-4 px-1">
                  <div className="px-4 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-3xl border border-emerald-500/20">RUNNING</div>
                  <div className="text-xs text-slate-500">{runningPackages.length}</div>
                </div>
                <div className="space-y-4">
                  {runningPackages.map(pkg => (
                    <PackageCard 
                      key={pkg.id} 
                      pkg={pkg} 
                      isSelected={pkg.id === selectedId}
                      onSelect={() => setSelectedId(pkg.id)}
                      onStatusChange={setPackageStatus}
                    />
                  ))}
                  {runningPackages.length === 0 && (
                    <div className="bg-white/5 border border-dashed border-white/20 rounded-3xl h-64 flex items-center justify-center text-slate-500 text-sm">
                      No active package — start one from blocked
                    </div>
                  )}
                </div>
              </div>

              {/* BLOCKED Column */}
              <div>
                <div className="flex items-center gap-3 mb-4 px-1">
                  <div className="px-4 py-1 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-3xl border border-amber-500/20">BLOCKED</div>
                  <div className="text-xs text-slate-500">{blockedPackages.length}</div>
                </div>
                <div className="space-y-4">
                  {blockedPackages.map(pkg => (
                    <PackageCard 
                      key={pkg.id} 
                      pkg={pkg} 
                      isSelected={pkg.id === selectedId}
                      onSelect={() => setSelectedId(pkg.id)}
                      onStatusChange={setPackageStatus}
                    />
                  ))}
                </div>
              </div>

              {/* DONE Column */}
              <div>
                <div className="flex items-center gap-3 mb-4 px-1">
                  <div className="px-4 py-1 bg-slate-500/10 text-slate-400 text-xs font-medium rounded-3xl border border-slate-500/20">DONE</div>
                  <div className="text-xs text-slate-500">{donePackages.length}</div>
                </div>
                <div className="space-y-4">
                  {donePackages.map(pkg => (
                    <PackageCard 
                      key={pkg.id} 
                      pkg={pkg} 
                      isSelected={pkg.id === selectedId}
                      onSelect={() => setSelectedId(pkg.id)}
                      onStatusChange={setPackageStatus}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT INSPECTOR */}
        <div className="w-96 border-l border-white/10 bg-[#0a111d] overflow-auto">
          {selectedPackage ? (
            <div className="p-8">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className={cn(
                    "inline-flex px-3 py-1 text-xs font-medium rounded-3xl mb-3",
                    selectedPackage.status === 'running' && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
                    selectedPackage.status === 'blocked' && "bg-amber-500/10 text-amber-400 border border-amber-500/30",
                    selectedPackage.status === 'done' && "bg-slate-500/10 text-slate-400 border border-slate-500/30"
                  )}>
                    {selectedPackage.status.toUpperCase()}
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight leading-none pr-6">{selectedPackage.title}</h2>
                </div>
                <div className="text-right text-xs text-slate-500">
                  Step {selectedPackage.currentStep}<br/>of 5
                </div>
              </div>

              {/* Visible 5-step Arbitration Loop */}
              <div className="mb-10">
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-4">5-STEP ARBITRATION LOOP</div>
                <div className="space-y-3">
                  {ARBITRATION_STEPS.map((step, idx) => {
                    const isCurrent = step.number === selectedPackage.currentStep
                    const isCompleted = step.number < selectedPackage.currentStep
                    return (
                      <div 
                        key={step.number}
                        className={cn(
                          "flex gap-4 border-l-2 pl-5 py-1 transition-all group",
                          isCurrent ? "border-emerald-400" : isCompleted ? "border-emerald-500/40" : "border-white/10"
                        )}
                      >
                        <div className={cn(
                          "w-6 h-6 flex-shrink-0 rounded-2xl flex items-center justify-center text-xs font-mono border",
                          isCurrent 
                            ? "bg-emerald-400 text-[#05080f] border-emerald-400" 
                            : isCompleted 
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40" 
                              : "bg-white/5 text-slate-400 border-white/20"
                        )}>
                          {step.number}
                        </div>
                        <div className="flex-1">
                          <div className={cn(
                            "font-medium text-sm",
                            isCurrent ? "text-white" : isCompleted ? "text-emerald-300/80" : "text-slate-400"
                          )}>
                            {step.title}
                          </div>
                          <div className="text-xs text-slate-500 leading-snug mt-0.5">{step.desc}</div>
                        </div>
                        {isCompleted && <Check className="w-4 h-4 text-emerald-400 mt-1" />}
                        {isCurrent && <div className="text-[10px] self-center px-2.5 py-px bg-emerald-400/10 text-emerald-400 rounded">ACTIVE</div>}
                      </div>
                    )
                  })}
                </div>
                {selectedPackage.currentStep < 5 && (
                  <button
                    onClick={() => advanceArbitrationStep(selectedPackage.id)}
                    disabled={isTransitioning}
                    className="mt-6 w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 py-3.5 rounded-2xl text-sm transition disabled:opacity-50"
                  >
                    ADVANCE TO NEXT ARBITRATION STEP
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Live Checklist - blocks DONE */}
              <div className="mb-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs uppercase tracking-widest text-slate-400">MANDATORY LIVE CHECKLIST</div>
                  {isChecklistComplete && (
                    <div className="text-emerald-400 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> ALL REQUIRED COMPLETE
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  {selectedPackage.checklist.length > 0 ? (
                    selectedPackage.checklist.map(item => (
                      <div 
                        key={item.id}
                        onClick={() => toggleChecklistItem(selectedPackage.id, item.id)}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3.5 rounded-2xl border cursor-pointer transition",
                          item.completed 
                            ? "border-emerald-500/30 bg-emerald-500/5" 
                            : "border-white/10 hover:border-white/20 bg-white/5"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0",
                          item.completed ? "bg-emerald-500 border-emerald-500" : "border-slate-400"
                        )}>
                          {item.completed && <Check className="w-3.5 h-3.5 text-black" />}
                        </div>
                        <div className="flex-1 text-sm leading-tight pt-px">
                          {item.text}
                          {item.required && <span className="ml-2 text-[10px] text-rose-400/70">REQUIRED</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-400 text-sm italic p-4 border border-dashed border-white/10 rounded-2xl">No checklist items. Add via API in next slice.</div>
                  )}
                </div>
                
                {!isChecklistComplete && selectedPackage.checklist.some(i => i.required && !i.completed) && (
                  <div className="mt-4 text-xs text-amber-400/80 flex items-center gap-2 bg-amber-500/5 border border-amber-500/20 p-3 rounded-2xl">
                    <AlertTriangle className="w-4 h-4" />
                    Complete all REQUIRED items before marking DONE
                  </div>
                )}
              </div>

              {/* Stall Indicator */}
              {selectedPackage.stallSignal && (
                <div className="mb-8 rounded-3xl border border-rose-400/30 bg-[#160c0c] p-5">
                  <div className="flex items-center gap-3 text-rose-300 mb-2">
                    <AlertTriangle className="w-5 h-5" />
                    <div className="font-medium uppercase tracking-widest text-xs">STALL DETECTED</div>
                  </div>
                  <div className="text-sm text-rose-100/90">{selectedPackage.stallSignal.reason}</div>
                  <div className="text-xs text-rose-400/60 mt-3">Detected {formatTimeAgo(selectedPackage.stallSignal.detectedAt)}</div>
                </div>
              )}

              {/* Action Controls */}
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-4">NEXT STEP CONTROLS</div>
                <div className="grid grid-cols-2 gap-3">
                  {selectedPackage.status !== 'running' && (
                    <button 
                      onClick={() => setPackageStatus(selectedPackage.id, 'running')}
                      className="col-span-2 bg-emerald-600 hover:bg-emerald-500 py-4 rounded-3xl text-sm font-medium flex items-center justify-center gap-2 transition active:scale-[0.985]"
                    >
                      <Play className="w-4 h-4" />
                      ACTIVATE AS RUNNING (enforces single active)
                    </button>
                  )}
                  
                  {selectedPackage.status === 'running' && (
                    <>
                      <button 
                        onClick={() => setPackageStatus(selectedPackage.id, 'blocked')}
                        className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 py-4 rounded-3xl text-sm font-medium text-amber-300 transition"
                      >
                        MARK BLOCKED
                      </button>
                      <button 
                        onClick={() => setPackageStatus(selectedPackage.id, 'done')}
                        disabled={!isChecklistComplete}
                        className={cn(
                          "py-4 rounded-3xl text-sm font-medium transition",
                          isChecklistComplete 
                            ? "bg-emerald-500 hover:bg-emerald-600 text-white" 
                            : "bg-white/5 text-slate-500 cursor-not-allowed border border-white/10"
                        )}
                      >
                        MARK DONE
                      </button>
                    </>
                  )}

                  <button 
                    onClick={() => advanceArbitrationStep(selectedPackage.id)}
                    className="col-span-2 mt-2 border border-white/10 hover:bg-white/5 py-4 rounded-3xl text-sm flex items-center justify-center gap-2"
                  >
                    ADVANCE ARBITRATION LOOP
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="mt-8 text-[10px] text-slate-500 leading-relaxed border-t border-white/10 pt-6">
                  This slice enforces doctrine in the client: only one running package, checklist required for DONE transition, visible arbitration, stall signals, and prominent active package in left rail. 
                  Next slices: persist to Airtable, real API endpoints with server-side validation, drag-and-drop between columns, real-time updates.
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-slate-400">Select a package from the Kanban.</div>
          )}
        </div>
      </div>
    </div>
  )
}

interface PackageCardProps {
  pkg: OperationalPackage
  isSelected: boolean
  onSelect: () => void
  onStatusChange: (id: string, status: PackageStatus) => void
}

function PackageCard({ pkg, isSelected, onSelect, onStatusChange }: PackageCardProps) {
  const isRunning = pkg.status === 'running'
  const isBlocked = pkg.status === 'blocked'
  const isDone = pkg.status === 'done'

  return (
    <div 
      onClick={onSelect}
      className={cn(
        "rounded-3xl p-6 border transition-all cursor-pointer group relative",
        isSelected && "ring-1 ring-offset-4 ring-offset-[#05080f] ring-white/30",
        isRunning && "border-emerald-400/60 bg-[#0c1620]",
        isBlocked && "border-amber-400/40 bg-[#1a140f]",
        isDone && "border-slate-500/40 bg-[#111111] opacity-75"
      )}
    >
      <div className="flex justify-between items-start">
        <div className={cn(
          "text-xs font-medium px-3 py-1 rounded-3xl",
          isRunning && "bg-emerald-500/20 text-emerald-300",
          isBlocked && "bg-amber-500/20 text-amber-300",
          isDone && "bg-slate-500/20 text-slate-400"
        )}>
          {pkg.status.toUpperCase()}
        </div>
        
        <div className="text-[10px] font-mono text-slate-500">STEP {pkg.currentStep}</div>
      </div>

      <div className="mt-5 font-medium leading-tight text-lg pr-2 group-hover:text-white transition-colors">
        {pkg.title}
      </div>

      <div className="mt-6 flex items-center text-xs text-slate-400">
        <span>Assigned to {pkg.assignedTo}</span>
        <span className="mx-2">•</span>
        <span>{formatTimeAgoStatic(pkg.updatedAt)}</span>
      </div>

      {pkg.stallSignal && (
        <div className="absolute bottom-6 right-6 text-rose-400">
          <AlertTriangle className="w-5 h-5" />
        </div>
      )}

      {pkg.nextRecommendedAction && (
        <div className="mt-8 pt-4 border-t border-white/10 text-xs text-slate-400 line-clamp-2">
          Next: {pkg.nextRecommendedAction}
        </div>
      )}

      {/* Quick status actions on card */}
      <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition flex flex-col gap-2">
        {isBlocked && (
          <button 
            onClick={(e) => { e.stopPropagation(); onStatusChange(pkg.id, 'running'); }}
            className="text-[10px] bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded-2xl"
          >
            ACTIVATE
          </button>
        )}
        {isRunning && (
          <button 
            onClick={(e) => { e.stopPropagation(); onStatusChange(pkg.id, 'done'); }}
            className="text-[10px] bg-white/10 hover:bg-white/20 px-3 py-1 rounded-2xl"
          >
            COMPLETE
          </button>
        )}
      </div>
    </div>
  )
}

function formatTimeAgoStatic(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
  return diffHrs > 0 ? `${diffHrs}h` : 'now'
}
