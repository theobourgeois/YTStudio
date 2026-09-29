import type { ComponentType, CSSProperties, ReactNode } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The parts of a menu, so the same items can fill a card's "⋯" dropdown and
 * its right-click menu: write them once against a `MenuKit`, render them with
 * `dropdownKit` or `contextKit`.
 */
export interface MenuKit {
  Item: ComponentType<{
    onSelect?: (event: Event) => void;
    disabled?: boolean;
    variant?: "default" | "destructive";
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
  }>;
  Separator: ComponentType;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ disabled?: boolean; children?: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children?: ReactNode }>;
}

export const dropdownKit: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

export const contextKit: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};
