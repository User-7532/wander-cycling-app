import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-xl border border-input bg-white/70 px-4 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        // iOS Safari gives date/datetime-local inputs their own
        // locale-based intrinsic minimum width that plain `width: 100%`
        // doesn't override, so the box visibly overflows its container on
        // iPhone (confirmed via screenshot) even though it renders fine on
        // desktop/Chromium. min-w-0 is the standard fix for this.
        (type === 'date' || type === 'datetime-local') && 'min-w-0',
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }
