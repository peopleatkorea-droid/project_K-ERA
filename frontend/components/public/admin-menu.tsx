"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { adminMenuCaretClass, adminMenuClass, adminMenuDropdownClass, adminMenuItemClass, adminMenuTriggerClass } from "../ui/workspace-patterns";
import { pick, useI18n } from "../../lib/i18n";

type AdminMenuProps = {
  className?: string;
  links: Array<{ label: string; href: string }>;
  recoveryLabel: string;
};

export function AdminMenu({ className = "", links, recoveryLabel }: AdminMenuProps) {
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const allLinks = [{ label: recoveryLabel, href: "/admin-login" }, ...links];

  return (
    <div className={cn(adminMenuClass, className)} ref={menuRef}>
      <button
        type="button"
        className={cn(adminMenuTriggerClass(isOpen))}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {pick(locale, "Admin", "관리자")}
        <span className={adminMenuCaretClass(isOpen)} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className={adminMenuDropdownClass}>
          {allLinks.map((item) => (
            <Link key={item.href} href={item.href} className={adminMenuItemClass} onClick={() => setIsOpen(false)}>
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
