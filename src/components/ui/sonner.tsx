import { PiCheckCircle, PiInfo, PiSpinnerGap, PiWarning, PiXCircle } from "react-icons/pi"
import { useTheme } from "@/stores/theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useTheme((s) => s.resolved)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <PiCheckCircle className="size-4" />,
        info: <PiInfo className="size-4" />,
        warning: <PiWarning className="size-4" />,
        error: <PiXCircle className="size-4" />,
        loading: <PiSpinnerGap className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--bevel-shadow)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "!shadow-float" } }}
      {...props}
    />
  )
}

export { Toaster }
