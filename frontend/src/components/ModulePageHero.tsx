import React from "react";
import type { LucideIcon } from "lucide-react";
import { useDenseDesktopViewport } from "../utils/denseViewport";

type HeroTone = "neutral" | "accent" | "success" | "warning" | "danger";

interface HeroPill {
  label: string;
  tone?: HeroTone;
}

interface HeroStat {
  label: string;
  value: string;
  hint?: string;
}

interface ModulePageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  icon?: LucideIcon;
  pills?: readonly HeroPill[];
  stats?: readonly HeroStat[];
  actions?: React.ReactNode;
  className?: string;
  dense?: boolean;
}

const PILL_TONE_CLASS: Record<HeroTone, string> = {
  neutral: "border-zinc-800 bg-[#101010] text-zinc-300",
  accent: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/20 bg-red-500/10 text-red-300",
};

const ModulePageHero: React.FC<ModulePageHeroProps> = ({
  eyebrow,
  title,
  description,
  icon: Icon,
  pills = [],
  stats = [],
  actions,
  className = "",
  dense,
}) => {
  const isDenseViewport = dense ?? useDenseDesktopViewport();

  return (
    <section
      className={`relative overflow-hidden border border-border bg-[radial-gradient(circle_at_top_right,rgba(254,254,0,0.08),transparent_42%),linear-gradient(180deg,rgba(23,23,23,0.96),rgba(12,12,12,0.98))] shadow-2xl ${
        isDenseViewport ? "rounded-[26px]" : "rounded-[32px]"
      } ${className}`.trim()}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/40 to-transparent" />
      <div className={`relative ${isDenseViewport ? "p-5 md:p-6" : "p-6 md:p-8"}`}>
        <div className={`flex flex-col ${isDenseViewport ? "gap-4 xl:gap-5" : "gap-6"} xl:flex-row xl:items-start xl:justify-between`}>
          <div className="min-w-0">
            <div className={`flex items-start ${isDenseViewport ? "gap-3" : "gap-4"}`}>
              {Icon ? (
                <div className={`flex shrink-0 items-center justify-center border border-primary/20 bg-primary/10 text-primary shadow-[0_0_30px_rgba(254,254,0,0.08)] ${
                  isDenseViewport ? "h-11 w-11 rounded-[18px]" : "h-14 w-14 rounded-md"
                }`}>
                  <Icon size={isDenseViewport ? 20 : 24} />
                </div>
              ) : null}
              <div className="min-w-0">
                <p className="text-[10px] font-medium] text-zinc-500">
                  {eyebrow}
                </p>
                <h1 className={`mt-2 font-bold tracking-tight text-white ${
                  isDenseViewport ? "text-[2rem] leading-none sm:text-4xl" : "text-3xl sm:text-4xl"
                }`}>
                  {title}
                </h1>
                <p className={`max-w-3xl leading-relaxed text-zinc-400 ${
                  isDenseViewport ? "mt-3 text-[13px]" : "mt-4 text-sm"
                }`}>
                  {description}
                </p>
              </div>
            </div>

            {pills.length > 0 ? (
              <div className={`flex flex-wrap gap-2 ${isDenseViewport ? "mt-4" : "mt-5"}`}>
                {pills.map((pill) => (
                  <span
                    key={pill.label}
                    className={`rounded-full border font-medium] ${
                      isDenseViewport ? "px-2.5 py-1 text-[9px]" : "px-3 py-1.5 text-[10px]"
                    } ${
                      PILL_TONE_CLASS[pill.tone || "neutral"]
                    }`}
                  >
                    {pill.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {actions ? (
            <div className={`flex shrink-0 flex-wrap items-center xl:justify-end ${
              isDenseViewport ? "gap-2 xl:max-w-md" : "gap-3 xl:max-w-sm"
            }`}>
              {actions}
            </div>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
            isDenseViewport ? "mt-4 xl:grid-cols-2" : "mt-6 xl:grid-cols-3"
          }`}>
            {stats.map((stat) => (
              <div
                key={stat.label}
                className={`rounded-md border border-border bg-[#0d0d0d]/90 ${
                  isDenseViewport ? "p-3.5" : "p-4"
                }`}
              >
                <p className="text-[10px] font-medium] text-zinc-500">
                  {stat.label}
                </p>
                <p className={`font-bold text-white ${isDenseViewport ? "mt-1.5 text-base" : "mt-2 text-lg"}`}>{stat.value}</p>
                {stat.hint ? (
                  <p className={`leading-relaxed text-zinc-500 ${isDenseViewport ? "mt-1.5 text-[10px]" : "mt-2 text-[11px]"}`}>
                    {stat.hint}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default ModulePageHero;


