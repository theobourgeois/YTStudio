import { PiOpenAiLogo } from "react-icons/pi";
import { SiClaude } from "react-icons/si";
import type { AssistantProvider } from "@shared/assistant";
import { cn } from "cn";

/** A provider's mark: Claude's (in its orange) or OpenAI's (for Codex). */
export function ProviderIcon({ provider, className }: { provider: AssistantProvider; className?: string }) {
  return provider === "claude" ? (
    <SiClaude aria-hidden className={cn("shrink-0 text-[#d97757]", className)} />
  ) : (
    <PiOpenAiLogo aria-hidden className={cn("shrink-0", className)} />
  );
}
