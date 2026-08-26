"use client";

import { useEffect, useState } from "react";

const sections = [
  { id: "data-quality", label: "Data Quality", group: "Khái niệm" },
  { id: "statistical", label: "Thống kê (Statistical)", group: "Khái niệm" },
  { id: "semantic", label: "Kiểu dữ liệu (Semantic)", group: "Khái niệm" },
  { id: "system", label: "VDaAgent Concepts", group: "Hệ thống" },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function DocsTableOfContents() {
  const [activeId, setActiveId] = useState<SectionId>(sections[0].id);

  useEffect(() => {
    let frameId = 0;

    const updateActiveSection = () => {
      frameId = 0;
      const marker = Math.min(220, window.innerHeight * 0.3);
      let currentId: SectionId = sections[0].id;

      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= marker) {
          currentId = section.id;
        }
      }

      setActiveId(currentId);
    };

    const scheduleUpdate = () => {
      if (!frameId) frameId = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", scheduleUpdate);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <aside className="pub-docs-sidebar" aria-label="Mục lục tài liệu">
      {["Khái niệm", "Hệ thống"].map((group) => (
        <div className="pub-docs-toc-group" key={group}>
          <h4>{group}</h4>
          {sections
            .filter((section) => section.group === group)
            .map((section) => {
              const isActive = activeId === section.id;
              return (
                <a
                  className={isActive ? "active" : undefined}
                  href={`#${section.id}`}
                  aria-current={isActive ? "location" : undefined}
                  key={section.id}
                  onClick={() => setActiveId(section.id)}
                >
                  {section.label}
                </a>
              );
            })}
        </div>
      ))}
    </aside>
  );
}
