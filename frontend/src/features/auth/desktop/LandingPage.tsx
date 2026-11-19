import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  Database,
  Layers3,
  MessageCircleMore,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Users,
  WandSparkles,
} from "lucide-react";
import robotCoordinator from "../../../assets/agent-robots/robot-coordinator.png";
import robotChat from "../../../assets/agent-robots/robot-chat.png";
import robotCompare from "../../../assets/agent-robots/robot-compare.png";
import robotData from "../../../assets/agent-robots/robot-data.png";
import robotInsight from "../../../assets/agent-robots/robot-insight.png";
import robotReport from "../../../assets/agent-robots/robot-report.png";

type TourState = "intro" | "running" | "complete";
type SpotlightRect = { left: number; top: number; width: number; height: number; radius: number };

const agents = [
  { name: "Điều phối", role: "Kết nối toàn đội", image: robotCoordinator, tone: "cyan" },
  { name: "Chat", role: "Trợ lý hội thoại", image: robotChat, tone: "green" },
  { name: "Compare", role: "So sánh dữ liệu", image: robotCompare, tone: "violet" },
  { name: "Data", role: "Nghiên cứu dữ liệu", image: robotData, tone: "blue" },
  { name: "Insight", role: "Tìm kiếm góc nhìn", image: robotInsight, tone: "amber" },
  { name: "Report", role: "Tạo báo cáo", image: robotReport, tone: "pink" },
] as const;

const steps = [
  {
    target: "agents",
    eyebrow: "01 · ĐỘI NGŨ AI",
    title: "Trò chuyện với 6 agent chuyên biệt",
    body: "Mỗi agent đảm nhiệm một chuyên môn nhưng luôn phối hợp trong cùng một luồng công việc.",
    placement: "agents",
    theme: "dark",
  },
  {
    target: "add-agent",
    eyebrow: "02 · MỞ RỘNG ĐỘI NGŨ",
    title: "Tạo agent theo nhu cầu riêng",
    body: "Bổ sung vai trò, kỹ năng và cách phản hồi phù hợp với quy trình của tổ chức.",
    placement: "add-agent",
    theme: "light",
  },
  {
    target: "group",
    eyebrow: "03 · CỘNG TÁC",
    title: "Tạo nhóm chat có cả người và agent",
    body: "Đưa đồng nghiệp và nhiều agent vào một phòng để cùng phân tích, phản biện và chốt phương án.",
    placement: "group",
    theme: "dark",
  },
  {
    target: "domain",
    eyebrow: "04 · TRI THỨC DOANH NGHIỆP",
    title: "Thêm domain mới mà không phá luồng làm việc",
    body: "Kết nối dữ liệu, quy tắc và ngữ cảnh chuyên ngành vào một không gian được kiểm soát.",
    placement: "domain",
    theme: "light",
  },
  {
    target: "coach",
    eyebrow: "05 · AGENT TỐI ƯU AGENT",
    title: "Chỉnh output bằng hội thoại, không cần sửa code",
    body: "Phản hồi trực tiếp cho agent. Agent điều phối sẽ biến yêu cầu thành chỉ dẫn và giúp agent chuyên môn tự cải thiện cách trình bày.",
    placement: "coach",
    theme: "important",
  },
  {
    target: "result",
    eyebrow: "06 · KẾT QUẢ",
    title: "Từ câu hỏi đến báo cáo có thể sử dụng ngay",
    body: "Kết quả rõ ràng, có nguồn dẫn và có thể tiếp tục tinh chỉnh ngay trong cuộc trò chuyện.",
    placement: "result",
    theme: "dark",
  },
] as const;

export function LandingPage({ openAuth }: { openAuth(): void }) {
  const [tourState, setTourState] = useState<TourState>("intro");
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const current = steps[step];
  const progress = tourState === "complete" ? 100 : ((step + 1) / steps.length) * 100;
  const targetClass = useMemo(
    () => (target: string) =>
      tourState === "running" && current.target === target ? " is-tour-target" : "",
    [current.target, tourState],
  );

  useEffect(() => {
    if (tourState !== "running") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        advance();
      }
      if (event.key === "ArrowLeft" && step > 0) {
        event.preventDefault();
        setStep((value) => value - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useLayoutEffect(() => {
    if (tourState !== "running") {
      setSpotlight(null);
      return;
    }

    const viewport = viewportRef.current;
    const target = viewport?.querySelector<HTMLElement>(".is-tour-target");
    if (!viewport || !target) return;

    const updateSpotlight = () => {
      const viewportBox = viewport.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const padding = current.target === "agents" ? 4 : 7;
      setSpotlight({
        left: targetBox.left - viewportBox.left - padding,
        top: targetBox.top - viewportBox.top - padding,
        width: targetBox.width + padding * 2,
        height: targetBox.height + padding * 2,
        radius: current.target === "agents" ? 17 : 13,
      });
    };

    updateSpotlight();
    const animationFrame = window.requestAnimationFrame(updateSpotlight);
    const transitionTimer = window.setTimeout(updateSpotlight, 700);
    const observer = new ResizeObserver(updateSpotlight);
    observer.observe(viewport);
    observer.observe(target);
    window.addEventListener("resize", updateSpotlight);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(transitionTimer);
      observer.disconnect();
      window.removeEventListener("resize", updateSpotlight);
    };
  }, [current.target, tourState]);

  function start() {
    setStep(0);
    setTourState("running");
  }

  function advance() {
    if (step === steps.length - 1) {
      setTourState("complete");
      return;
    }
    setStep((value) => value + 1);
  }

  function retreat() {
    setStep((value) => Math.max(0, value - 1));
  }

  return (
    <div className="vda-landing">
      <section className="vda-hero" aria-labelledby="landing-title">
        <div className="vda-hero-copy">
          <span className="vda-hero-pill"><Sparkles size={14} /> Nền tảng cộng tác đa agent</span>
          <h1 id="landing-title">
            Một câu hỏi.
            <span>Sáu chuyên gia AI cùng giải quyết.</span>
          </h1>
          <p>
            Khám phá cách VDaAgent kết nối con người, dữ liệu và một đội ngũ agent có khả năng
            tự cải thiện qua chính cuộc trò chuyện của bạn.
          </p>
          <div className="vda-hero-proof" aria-label="Điểm nổi bật">
            <span><Check size={14} /> Không cần cài đặt</span>
            <span><Check size={14} /> Demo tương tác</span>
            <span><Check size={14} /> Dữ liệu an toàn</span>
          </div>
        </div>
        <div className="vda-orbit" aria-hidden="true">
          <div className="vda-orbit-ring vda-orbit-ring-one" />
          <div className="vda-orbit-ring vda-orbit-ring-two" />
          <img src={robotCoordinator} alt="" />
          <span className="vda-orbit-chip vda-chip-one"><Database size={14} /> Data</span>
          <span className="vda-orbit-chip vda-chip-two"><BrainCircuit size={14} /> Insight</span>
          <span className="vda-orbit-chip vda-chip-three"><Users size={14} /> Team</span>
        </div>
      </section>

      <section className="vda-demo-section" aria-labelledby="demo-title">
        <div className="vda-section-heading">
          <span>THỬ TRƯỚC KHI ĐĂNG NHẬP</span>
          <h2 id="demo-title">Tự mình khám phá một vòng VDaAgent</h2>
          <p>Nhấn vào điểm được làm nổi bật hoặc dùng phím Enter để đi qua từng chức năng.</p>
        </div>

        <div className={`vda-demo-frame is-${tourState} is-step-${step}`}>
          <div className="vda-demo-progress" aria-label={`Tiến độ ${Math.round(progress)}%`}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="vda-demo-browserbar">
            <div><i /><i /><i /></div>
            <span><Bot size={14} /> workspace.vdaagent.local</span>
            <b>{tourState === "complete" ? "Hoàn tất" : `${step + 1}/${steps.length}`}</b>
          </div>

          <div className="vda-demo-viewport" ref={viewportRef}>
            <div className={`vda-demo-canvas is-target-${current.target}`}>
              <aside className="vda-demo-rail">
                <div className="vda-demo-logo"><Bot size={19} /></div>
                <button type="button" aria-label="Trò chuyện" className="is-selected"><MessageCircleMore size={18} /></button>
                <button type="button" aria-label="Agents"><Bot size={18} /></button>
                <button type="button" aria-label="Dữ liệu"><Database size={18} /></button>
                <button type="button" aria-label="Domains"><Layers3 size={18} /></button>
              </aside>

              <aside className={`vda-demo-agents${targetClass("agents")}`}>
                <div className="vda-demo-panel-title">
                  <div><strong>Trò chuyện</strong><span>6 agent đang sẵn sàng</span></div>
                  <button
                    type="button"
                    className={`vda-demo-add-agent${targetClass("add-agent")}`}
                    onClick={advance}
                    aria-label="Tạo agent mới"
                  ><Plus size={16} /></button>
                </div>
                <div className="vda-agent-list">
                  {agents.map((agent, index) => (
                    <button
                      type="button"
                      key={agent.name}
                      className={index === 0 ? "is-active" : ""}
                      onClick={tourState === "running" && step === 0 ? advance : undefined}
                    >
                      <span className={`vda-agent-avatar is-${agent.tone}`}><img src={agent.image} alt="" /></span>
                      <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                      <i />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={`vda-demo-new-group${targetClass("group")}`}
                  onClick={tourState === "running" && step === 2 ? advance : undefined}
                ><Users size={15} /> Nhóm dự án mới <Plus size={14} /></button>
              </aside>

              <main className="vda-demo-chat">
                <header>
                  <div>
                    <span className="vda-chat-robot"><img src={robotCoordinator} alt="" /></span>
                    <span><strong>Điều phối</strong><small><i /> đang sẵn sàng</small></span>
                  </div>
                  <button
                    type="button"
                    className={`vda-demo-domain${targetClass("domain")}`}
                    onClick={tourState === "running" && step === 3 ? advance : undefined}
                  ><Database size={14} /> Domain: Vinhomes <Plus size={13} /></button>
                </header>
                <div className="vda-chat-body">
                  <div className="vda-message is-agent">
                    <span className="vda-message-avatar"><img src={robotCoordinator} alt="" /></span>
                    <div>
                      <small>Điều phối · vừa xong</small>
                      <p>Tôi đã kết nối Data, Compare và Insight. Bạn muốn báo cáo tập trung vào điều gì?</p>
                    </div>
                  </div>
                  <div className="vda-message is-user">
                    <p>Phân tích tồn kho và cho tôi một bản tóm tắt dễ trình bày với ban lãnh đạo.</p>
                  </div>
                  <div className={`vda-coach-card${targetClass("coach")}`}>
                    <WandSparkles size={18} />
                    <div><strong>Coach agent bằng hội thoại</strong><span>“Rút gọn phần kết luận, ưu tiên rủi ro và hành động tiếp theo.”</span></div>
                    <button type="button" onClick={tourState === "running" && step === 4 ? advance : undefined}>Gửi hướng dẫn</button>
                  </div>
                  <div className={`vda-result-card${targetClass("result")}`}>
                    <div className="vda-result-head"><span><Sparkles size={15} /> Bản trả lời đã được tối ưu</span><small>6 agent phối hợp</small></div>
                    <h3>Ba ưu tiên cho tồn kho quý này</h3>
                    <div className="vda-result-grid">
                      <span><b>01</b> Xử lý nhóm tồn trên 180 ngày</span>
                      <span><b>02</b> So sánh theo dự án và phân khúc</span>
                      <span><b>03</b> Xuất báo cáo có nguồn dẫn</span>
                    </div>
                    <button type="button" onClick={tourState === "running" && step === 5 ? advance : undefined}>Mở báo cáo <ArrowRight size={14} /></button>
                  </div>
                </div>
              </main>
            </div>

            {tourState === "running" && spotlight && (
              <div className={`vda-tour-dimmer is-${current.theme}`} aria-hidden="true">
                <i
                  style={{
                    left: spotlight.left,
                    top: spotlight.top,
                    width: spotlight.width,
                    height: spotlight.height,
                    borderRadius: spotlight.radius,
                  }}
                />
              </div>
            )}

            {tourState === "intro" && (
              <div className="vda-demo-intro">
                <span><Play size={18} fill="currentColor" /></span>
                <p>Interactive product tour</p>
                <h3>Khám phá VDaAgent trong 6 bước</h3>
                <small>Không cần đăng nhập · khoảng 90 giây</small>
                <button type="button" onClick={start}>Bắt đầu khám phá <ArrowRight size={17} /></button>
              </div>
            )}

            {tourState === "running" && (
              <div
                key={step}
                className={`vda-tour-tooltip is-${current.placement} is-${current.theme}`}
                role="status"
                aria-live="polite"
              >
                <button type="button" className="vda-tour-skip" onClick={() => setTourState("complete")}>Bỏ qua</button>
                <span>{current.eyebrow}</span>
                <h3>{current.title}</h3>
                <p>{current.body}</p>
                <div className="vda-tour-footer">
                  <small>{step + 1} / {steps.length}</small>
                  <div className="vda-tour-actions">
                    <button
                      type="button"
                      className="vda-tour-prev"
                      onClick={retreat}
                      disabled={step === 0}
                      aria-label="Bước trước"
                    ><ArrowLeft size={19} /></button>
                    <button
                      type="button"
                      className="vda-tour-next"
                      onClick={advance}
                      aria-label={step === steps.length - 1 ? "Hoàn tất" : "Bước tiếp theo"}
                    ><ArrowRight size={19} /></button>
                  </div>
                </div>
              </div>
            )}

            {tourState === "complete" && (
              <div className="vda-demo-complete">
                <span className="vda-complete-icon"><Sparkles size={22} /></span>
                <small>YOUR AI WORKSPACE</small>
                <h3>Create your own agent</h3>
                <p>Biến quy trình của bạn thành một đội ngũ AI có thể cộng tác và tự cải thiện.</p>
                <button type="button" onClick={openAuth}>Create your own agent <ArrowRight size={17} /></button>
                <button type="button" className="vda-replay" onClick={start}><RotateCcw size={15} /> Replay</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="vda-value-grid" aria-label="Năng lực chính">
        <article><MessageCircleMore size={20} /><h3>Một cuộc trò chuyện</h3><p>Làm việc xuyên suốt với 6 agent và đồng nghiệp trong cùng một ngữ cảnh.</p></article>
        <article><Layers3 size={20} /><h3>Nhiều domain</h3><p>Mang dữ liệu và kiến thức riêng của từng ngành vào hệ thống một cách có kiểm soát.</p></article>
        <article><WandSparkles size={20} /><h3>Agent tự cải thiện</h3><p>Chỉnh chất lượng output bằng lời nói tự nhiên thay vì quay lại sửa code.</p></article>
      </section>
    </div>
  );
}
