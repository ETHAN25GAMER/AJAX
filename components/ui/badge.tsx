import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] leading-none",
  {
    variants: {
      variant: {
        default: "text-foreground/70",
        urgencyHigh: "text-urgency-high",
        urgencyNormal: "text-urgency-normal",
        urgencyLow: "text-urgency-low",
        muted: "text-muted-foreground"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
