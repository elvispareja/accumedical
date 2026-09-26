import type { LabelHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('font-display text-[0.8125rem] font-medium text-tinta', className)}
      {...props}
    />
  )
}
