import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-xl border border-input bg-white/70 px-4 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        // iOS Safari renders date/datetime-local inputs with their own
        // native "menulist" chrome, which has a locale-based intrinsic
        // width that plain `width: 100%` / `min-width: 0` do NOT override
        // (confirmed via screenshot -- the box itself overflows past its
        // container, even the whole page, on real iPhone Safari and LINE's
        // in-app browser, despite rendering fine on desktop/Chromium).
        // Stripping that native chrome with appearance:none is the fix
        // that actually works for this -- tapping still opens the native
        // date/time picker, only the inline "chip" rendering changes to a
        // normal text-like box that properly respects CSS width.
        (type === 'date' || type === 'datetime-local') && 'min-w-0 appearance-none',
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
