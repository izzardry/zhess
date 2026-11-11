// Ported from Zudoku (src/components/ui/sonner.tsx) without next-themes:
// the theme follows the system, like the rest of the app (see main.tsx).
//
// Placement (Ztyle 05 safe areas; final visual pass): toasts never cover the game chrome.
// - Portrait: bottom right on wide screens, full width on phones, always above the bottom toolbar
//   (its bottom inset max(1rem, safe area) + the bar's 58 px + 0.5rem), so the bottom safe area
//   is included too.
// - Mobile landscape: bottom right, narrowed to the space between the board and the right edge, so
//   it covers neither the board nor the rail (StatusBar keeps the bottom right free for it).
import { Toaster as Sonner, toast } from "sonner";
import { useIsMobileLandscape } from "@/hooks/use-orientation";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toasterPlacement } from "./toasterPlacement";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ className, ...props }: ToasterProps) => {
  const { t } = useI18n();
  const landscape = useIsMobileLandscape();
  const placement = toasterPlacement(landscape);
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      containerAriaLabel={t("platform.notifications")}
      offset={placement.offset}
      mobileOffset={placement.mobileOffset}
      style={placement.style}
      className={cn("toaster group", placement.className, className)}
      toastOptions={{
        classNames: {
          // `toast` gives custom toasts (requests) Ztyle's frame; `justify-start` undoes that recipe's
          // space-between, which pushed a system toast's text away from its icon.
          toast:
            "group toast justify-start group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:font-mono group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-foreground group-[.toast]:text-background group-[.toast]:uppercase group-[.toast]:tracking-wider",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- shadcn re-exports toast with the Toaster
export { Toaster, toast };
