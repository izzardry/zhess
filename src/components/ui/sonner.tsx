// Ported from Zudoku (src/components/ui/sonner.tsx) without next-themes:
// the theme follows the system, like the rest of the app (see main.tsx).
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="system"
    className="toaster group"
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:font-mono group-[.toaster]:rounded-xl",
        description: "group-[.toast]:text-muted-foreground",
        actionButton:
          "group-[.toast]:bg-foreground group-[.toast]:text-background group-[.toast]:uppercase group-[.toast]:tracking-wider",
        cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
      },
    }}
    {...props}
  />
);

// eslint-disable-next-line react-refresh/only-export-components -- shadcn re-exports toast with the Toaster
export { Toaster, toast };
