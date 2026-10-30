"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { joinClasses } from "./types";

export interface TabItem<T extends string> {
  key: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  selected: T;
  onSelect: (key: T) => void;
  label: string;
  className?: string;
}

export type TabNavigationKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function nextTabIndex(current: number, count: number, key: TabNavigationKey): number {
  if (count <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  return (current + 1) % count;
}

export function Tabs<T extends string>({ items, selected, onSelect, label, className }: TabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = nextTabIndex(index, items.length, event.key as TabNavigationKey);
    onSelect(items[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={joinClasses("dash-tabs", "dash-tabs--overflow", className)}>
      {items.map((item, index) => {
        const active = item.key === selected;
        return <button key={item.key} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1} className="dash-tabs__tab" onClick={() => onSelect(item.key)} onKeyDown={(event) => navigate(event, index)}>{item.label}</button>;
      })}
    </div>
  );
}
