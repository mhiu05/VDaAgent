"use client";

import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

type Story = {
  number: string;
  problem: { title: string; body: string };
  solution: { title: string; body: string };
};

function StoryToggle({ number, problem, solution }: Story) {
  const [showSolution, setShowSolution] = useState(false);
  const problemRef = useRef<HTMLDivElement>(null);
  const solutionRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const animating = useRef(false);

  useLayoutEffect(() => {
    const problemFace = problemRef.current;
    const solutionFace = solutionRef.current;
    if (!problemFace || !solutionFace) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const incoming = showSolution ? solutionFace : problemFace;
    const outgoing = showSolution ? problemFace : solutionFace;

    if (!initialized.current || reduced) {
      gsap.set(problemFace, { autoAlpha: showSolution ? 0 : 1, y: 0, rotateX: 0 });
      gsap.set(solutionFace, { autoAlpha: showSolution ? 1 : 0, y: 0, rotateX: 0 });
      initialized.current = true;
      animating.current = false;
      return;
    }

    const timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
      onComplete: () => { animating.current = false; },
    });
    timeline
      .to(outgoing, { autoAlpha: 0, y: -10, rotateX: -4, duration: 0.16 })
      .fromTo(incoming, { autoAlpha: 0, y: 12, rotateX: 4 }, { autoAlpha: 1, y: 0, rotateX: 0, duration: 0.34 });

    return () => { timeline.kill(); };
  }, [showSolution]);

  function toggle() {
    if (animating.current) return;
    animating.current = true;
    setShowSolution((current) => !current);
  }

  return <article className="pub-story-card">
    <button type="button" className="pub-story-toggle" onClick={toggle} aria-pressed={showSolution} aria-controls={`story-${number}`}>
      <span className={showSolution ? "pub-story-label pub-story-solution" : "pub-story-label"}>{showSolution ? "SOLUTION" : `PAINPOINT ${number}`}</span>
      <span className="pub-story-toggle-copy">{showSolution ? "Xem problem" : "Xem solution"} <span aria-hidden="true">↗</span></span>
    </button>
    <div className="pub-story-card-stage" id={`story-${number}`} aria-live="polite">
      <div className="pub-story-face" ref={problemRef}><h3>{problem.title}</h3><p>{problem.body}</p></div>
      <div className="pub-story-face" ref={solutionRef}><h3>{solution.title}</h3><p>{solution.body}</p></div>
    </div>
  </article>;
}

const stories: Story[] = [
  {
    number: "01",
    problem: {
      title: "Profiling thường bị phân mảnh",
      body: "Schema, kiểu dữ liệu, missing values, uniqueness, duplicate rows, outlier, correlation và rủi ro PII dễ bị kiểm tra ở nhiều nơi hoặc bị bỏ sót.",
    },
    solution: {
      title: "Quy trình profiling có cấu trúc",
      body: "Một Profile Run tập hợp các kiểm tra thiết yếu; các proposal về metadata, candidate key và PII vẫn chờ Analyst xác nhận khi cần.",
    },
  },
  {
    number: "02",
    problem: {
      title: "Metric chưa tự thành insight",
      body: "Missingness, outlier, correlation hay phân phối chỉ mô tả điều đang có. Analyst vẫn phải chọn câu hỏi, cách phân tích và kết luận được bằng chứng hỗ trợ.",
    },
    solution: {
      title: "Câu hỏi → evidence → insight",
      body: "VDaAgent tách computation xác định khỏi AI: engine tạo số liệu và biểu đồ; AI hỗ trợ lập kế hoạch, diễn giải và giải thích trên evidence đã được chấp thuận.",
    },
  },
];

export function ProblemSolutionToggle() {
  return <div className="pub-story-grid">{stories.map((story) => <StoryToggle key={story.number} {...story} />)}</div>;
}
