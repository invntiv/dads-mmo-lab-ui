import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretRightIcon,
  CheckIcon,
} from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { LottieLoop } from "@/components/lottie-loop"
import type {
  InstallLogEntry,
  InstallLogLine,
  InstallSection,
} from "@/components/server-state-context"
import loadingAnimation from "@/assets/lottie/loadingV4.json"

const STICK_THRESHOLD_PX = 24

export function InstallConsole({
  entries,
  pending,
  className,
}: {
  entries: InstallLogEntry[]
  pending: InstallLogLine | null
  className?: string
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = React.useState(true)

  // Section open/closed state lives here (not in each section component)
  // so the bottom-right pill can toggle the active section without the
  // user having to scroll back up to its header.
  const [openSectionIds, setOpenSectionIds] = React.useState<Set<number>>(
    () => new Set()
  )
  const setSectionOpen = React.useCallback((id: number, open: boolean) => {
    setOpenSectionIds((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
    const atBottom = distanceFromBottom < STICK_THRESHOLD_PX
    setStickToBottom((prev) => (prev === atBottom ? prev : atBottom))
  }, [])

  React.useEffect(() => {
    if (!stickToBottom) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entries, pending, stickToBottom, openSectionIds])

  const scrollToBottom = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setStickToBottom(true)
  }, [])

  // The "collapse the section" affordance targets the most recently
  // expanded section — usually the one the user is currently tailing
  // (active) or the one that just finished (done after the script
  // exited). Either way, if they're at the bottom of the console it's
  // the section currently occupying their attention.
  const lastExpandedSection = React.useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.kind === "section" && openSectionIds.has(entry.data.id)) {
        return entry.data
      }
    }
    return null
  }, [entries, openSectionIds])

  const collapseTarget = stickToBottom ? lastExpandedSection : null

  const empty = entries.length === 0 && !pending

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="ui-selectable h-full w-full overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[12.5px] leading-snug text-zinc-200"
      >
        {empty ? (
          <div className="text-zinc-500">Waiting for installer output…</div>
        ) : (
          <>
            {entries.map((entry) =>
              entry.kind === "line" ? (
                <ConsoleLine key={entry.data.id} line={entry.data} />
              ) : (
                <ConsoleSection
                  key={entry.data.id}
                  section={entry.data}
                  open={openSectionIds.has(entry.data.id)}
                  onOpenChange={(open) => setSectionOpen(entry.data.id, open)}
                />
              )
            )}
            {pending && <ConsoleLine line={pending} />}
          </>
        )}
      </div>

      {!stickToBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-lg backdrop-blur transition-colors hover:bg-zinc-800"
        >
          <ArrowDownIcon className="size-3.5" />
          Jump to latest
        </button>
      )}

      {collapseTarget && (
        <button
          type="button"
          onClick={() => setSectionOpen(collapseTarget.id, false)}
          className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-lg backdrop-blur transition-colors hover:bg-zinc-800"
        >
          <ArrowUpIcon className="size-3.5" />
          Collapse
        </button>
      )}
    </div>
  )
}

function ConsoleLine({ line }: { line: InstallLogLine }) {
  // Note: `stderr` is rendered in lime, NOT red. Docker / git / build
  // tools emit lifecycle info to stderr by convention even on success
  // (container Created/Started, git "Cloning into…", etc.) — colouring
  // those red made every install look catastrophic. Real failures
  // surface via the exit code + the system-stream "Installer failed"
  // line, not via stderr coloring.
  const color =
    line.stream === "stderr"
      ? "text-lime-400"
      : line.stream === "system"
        ? "text-amber-300"
        : line.stream === "highlight"
          ? "font-semibold text-fuchsia-400"
          : "text-zinc-200"
  return (
    <pre className={cn("whitespace-pre-wrap break-words", color)}>
      {line.text || " "}
    </pre>
  )
}

function ConsoleSection({
  section,
  open,
  onOpenChange,
}: {
  section: InstallSection
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const lineCount = section.lines.length + (section.pending ? 1 : 0)
  const isActive = section.state === "active"

  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange((e.target as HTMLDetailsElement).open)}
      className="my-1 rounded border border-zinc-800/80 bg-zinc-900/40"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-zinc-300 marker:hidden hover:bg-zinc-800/40 [&::-webkit-details-marker]:hidden">
        <CaretRightIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        {isActive ? (
          // `invert` flips the lottie's solid-black strokes to white so it
          // reads on the zinc-900 section background. Without it the
          // animation is invisible.
          <LottieLoop
            animationData={loadingAnimation}
            className="size-4 shrink-0 invert"
          />
        ) : (
          <CheckIcon
            aria-label="done"
            className="size-3.5 shrink-0 text-emerald-500"
          />
        )}
        <span className="truncate text-[12.5px]">{section.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-zinc-500">
          {lineCount.toLocaleString()} {lineCount === 1 ? "line" : "lines"}
        </span>
      </summary>
      {open && (
        <div className="border-t border-zinc-800/80 p-2">
          {section.lines.map((line) => (
            <ConsoleLine key={line.id} line={line} />
          ))}
          {section.pending && <ConsoleLine line={section.pending} />}
        </div>
      )}
    </details>
  )
}
