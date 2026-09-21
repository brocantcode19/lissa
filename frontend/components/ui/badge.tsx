import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-maroon text-gold",
        gold:        "bg-gold/15 text-gold-muted border border-gold/30",
        high:        "bg-green-100 text-green-700",
        medium:      "bg-yellow-100 text-yellow-700",
        low:         "bg-red-100 text-red-700",
        scope:       "bg-gray-100 text-gray-600",
        success:     "bg-green-100 text-green-700",
        pending:     "bg-yellow-100 text-yellow-700",
        failed:      "bg-red-100 text-red-700",
        processing:  "bg-blue-100 text-blue-700",
        outline:     "border border-border text-foreground bg-transparent",
        secondary:   "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
