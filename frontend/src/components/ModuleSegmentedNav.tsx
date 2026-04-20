import React, { startTransition } from "react";

interface ModuleSegmentedNavItem {
  id: string;
  label: string;
  hint: string;
}

interface ModuleSegmentedNavProps {
  items: readonly ModuleSegmentedNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
  sticky?: boolean;
}

const ModuleSegmentedNav: React.FC<ModuleSegmentedNavProps> = ({
  items,
  activeId,
  onSelect,
  className = "",
  sticky = true,
}) => {
  const stickyClass = sticky
    ? "sticky top-0 z-10 rounded-[1.75rem] border border-zinc-800/80 bg-[#111111]/88 p-2 backdrop-blur-xl"
    : "";

  return (
    <div className={`${stickyClass} ${className}`.trim()}>
      <div className="flex gap-3 overflow-x-auto custom-scrollbar">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                startTransition(() => onSelect(item.id));
              }}
              className={`min-w-[220px] flex-1 rounded-[1.35rem] border px-4 py-3 text-left transition-all ${
                isActive
                  ? "border-primary/30 bg-primary/10 text-white shadow-[0_16px_40px_-28px_rgba(254,254,0,0.45)]"
                  : "border-zinc-800 bg-black/20 text-zinc-300 hover:border-primary/20 hover:bg-black/30"
              }`}
            >
              <span
                className={`block text-[10px] font-medium] ${
                  isActive ? "text-primary" : "text-zinc-500"
                }`}
              >
                {item.label}
              </span>
              <span className="mt-2 block text-sm leading-relaxed">
                {item.hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModuleSegmentedNav;


