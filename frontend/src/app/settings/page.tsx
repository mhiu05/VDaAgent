"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingBlock, Notice, PageHeader } from "@/components/ui";
import { getWorkspaceConfiguration, updateWorkspaceConfiguration } from "@/lib/api";

export default function SettingsPage() {
  const client = useQueryClient();
  const configuration = useQuery({ queryKey: ["workspace-configuration"], queryFn: getWorkspaceConfiguration });
  const [domain, setDomain] = useState("");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [primary, setPrimary] = useState("#315efb");
  const [secondary, setSecondary] = useState("#18a77b");
  const [tone, setTone] = useState<"concise" | "professional" | "friendly">("professional");
  const [language, setLanguage] = useState<"vi" | "en">("vi");
  useEffect(() => {
    if (!configuration.data) return;
    const { context, theme } = configuration.data;
    setDomain(context?.domain || ""); setGoal(context?.primary_goal || ""); setAudience(context?.target_audience || "");
    setPrimary(theme?.primary_color || "#315efb"); setSecondary(theme?.secondary_color || "#18a77b");
    setTone(theme?.tone || "professional"); setLanguage(theme?.default_language || "vi");
  }, [configuration.data]);
  const update = useMutation({
    mutationFn: () => updateWorkspaceConfiguration({
      context: { domain, primary_goal: goal, target_audience: audience },
      theme: { primary_color: primary, secondary_color: secondary, tone, default_language: language },
      expected_context_version: configuration.data?.context?.version,
      expected_theme_version: configuration.data?.theme?.version,
    }),
    onSuccess: (next) => client.setQueryData(["workspace-configuration"], next),
  });
  function submit(event: FormEvent) { event.preventDefault(); update.mutate(); }
  if (configuration.isLoading) return <LoadingBlock label="Đang tải cấu hình workspace…" />;
  if (configuration.isError) return <ErrorNotice error={configuration.error} retry={() => configuration.refetch()} />;
  return <main className="page workspace-settings">
    <PageHeader title="Context & Theme" description="Context định hướng cách Agent diễn giải; theme chỉ thay đổi cách trình bày, không thay metric hay kết quả truy vấn." />
    {update.isError && <ErrorNotice error={update.error} retry={() => update.reset()} />}
    {update.isSuccess && <Notice tone="success">Đã lưu version cấu hình mới.</Notice>}
    <form className="panel workspace-settings-form" onSubmit={submit}>
      <fieldset><legend>Workspace Context <small>v{configuration.data?.context?.version ?? 1}</small></legend>
        <label>Lĩnh vực<input value={domain} onChange={(event) => setDomain(event.target.value)} maxLength={120} placeholder="Có thể để trống" /></label>
        <label>Mục tiêu chính<textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500} rows={4} placeholder="Có thể để trống và điền sau" /></label>
        <label>Đối tượng đọc<input value={audience} onChange={(event) => setAudience(event.target.value)} maxLength={120} placeholder="Ví dụ: Ban điều hành" /></label>
      </fieldset>
      <fieldset><legend>Workspace Theme <small>v{configuration.data?.theme?.version ?? 1}</small></legend>
        <div className="workspace-color-fields"><label>Màu chính<input type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} /></label><label>Màu phụ<input type="color" value={secondary} onChange={(event) => setSecondary(event.target.value)} /></label></div>
        <label>Tone<select value={tone} onChange={(event) => setTone(event.target.value as typeof tone)}><option value="professional">Chuyên nghiệp</option><option value="concise">Ngắn gọn</option><option value="friendly">Thân thiện</option></select></label>
        <label>Ngôn ngữ<select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
      </fieldset>
      <div className="workspace-settings-actions"><button className="button primary" disabled={update.isPending}>{update.isPending ? "Đang lưu…" : "Lưu version mới"}</button></div>
    </form>
  </main>;
}
