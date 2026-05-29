import * as React from "react"
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

const BASE_INPUT =
  "h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // Number inputs get app-styled stacked steppers instead of the
  // browser's tiny inset spinner. Everything else is the plain input.
  if (type === "number") {
    return <NumberInput className={className} {...props} />
  }
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(BASE_INPUT, className)}
      {...props}
    />
  )
}

/**
 * Number field rendered as an input-group: a bordered box wrapping a
 * borderless value input plus a stacked +/- stepper column. Each button
 * is half the field height and styled with the app's tokens (no more
 * inset native spinner). Used globally — `<Input type="number" />`
 * anywhere picks this up.
 *
 * Stepping uses the native value setter + a dispatched `input` event so
 * React `onChange` fires for controlled inputs.
 */
function NumberInput({
  className,
  disabled,
  ...props
}: React.ComponentProps<"input">) {
  const ref = React.useRef<HTMLInputElement>(null)

  const nudge = (dir: 1 | -1) => {
    const el = ref.current
    if (!el || el.disabled) return
    const step = Number(el.step) || 1
    const min = el.min !== "" ? Number(el.min) : Number.NEGATIVE_INFINITY
    const max = el.max !== "" ? Number(el.max) : Number.POSITIVE_INFINITY
    const cur = el.value === "" ? 0 : Number(el.value)
    let next = (Number.isFinite(cur) ? cur : 0) + dir * step
    next = Math.min(max, Math.max(min, next))
    // Round away binary-float fuzz from fractional steps.
    next = Math.round(next * 1e6) / 1e6
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set
    setter?.call(el, String(next))
    // React's onChange listens for the native `input` event.
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.focus()
  }

  return (
    <div
      data-slot="number-input"
      className={cn(
        "flex h-8 w-full min-w-0 items-stretch overflow-hidden rounded-none border border-input bg-transparent text-xs transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:bg-input/30",
        className
      )}
      aria-disabled={disabled}
    >
      <input
        ref={ref}
        type="number"
        data-slot="input"
        disabled={disabled}
        className={cn(
          // Borderless — the wrapper draws the box. Extra right padding
          // keeps the value clear of the stepper divider.
          "min-w-0 flex-1 bg-transparent px-2.5 py-1 pr-3 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none",
          className
        )}
        {...props}
      />
      <div className="flex w-6 shrink-0 select-none flex-col border-l border-input">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          disabled={disabled}
          onClick={() => nudge(1)}
          className="flex flex-1 items-center justify-center border-b border-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/70 disabled:pointer-events-none"
        >
          <CaretUpIcon className="size-3" weight="bold" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          disabled={disabled}
          onClick={() => nudge(-1)}
          className="flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/70 disabled:pointer-events-none"
        >
          <CaretDownIcon className="size-3" weight="bold" />
        </button>
      </div>
    </div>
  )
}

export { Input }
