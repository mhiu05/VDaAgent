import { PdfExportError, generateProfilingPdf } from "@/lib/pdf-report";

export const runtime = "nodejs";

const EXPORT_SECTIONS = new Set([
  "overview",
  "technical_profile",
  "quality",
  "agent_summary",
  "drift",
  "analysis",
  "report_snapshot",
]);

class ExportSourceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function requestedSections(value: string | null): string {
  const selected = (value || "")
    .split(",")
    .map((section) => section.trim())
    .filter((section) => EXPORT_SECTIONS.has(section));
  return (selected.length ? selected : [...EXPORT_SECTIONS]).join(",");
}

async function getExportSource(
  runId: string,
  reportId: string | null,
  sections: string,
  request: Request,
): Promise<Record<string, unknown>> {
  const apiBase = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").replace(/\/$/, "");
  const endpoint = reportId
    ? `/reports/${encodeURIComponent(reportId)}/export-source`
    : `/profile/${encodeURIComponent(runId)}/report`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const authorization = request.headers.get("authorization");
  const workspaceId = request.headers.get("x-workspace-id");
  if (authorization) headers.Authorization = authorization;
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${apiBase}${endpoint}?sections=${encodeURIComponent(sections)}`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if ([401, 403, 404, 409].includes(response.status)) {
        throw new ExportSourceError("Không thể truy cập nguồn dữ liệu báo cáo.", response.status);
      }
      throw new ExportSourceError("Không thể chuẩn bị dữ liệu báo cáo để xuất PDF.", 502);
    }
    return response.json() as Promise<Record<string, unknown>>;
  } catch (error) {
    if (error instanceof ExportSourceError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ExportSourceError("Chuẩn bị dữ liệu báo cáo mất quá nhiều thời gian.", 504);
    }
    throw new ExportSourceError("Không thể kết nối dịch vụ dữ liệu để xuất PDF.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function contentDisposition(runId: string, reportId: string | null): string {
  const identity = (reportId || runId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "report";
  return `attachment; filename="data-profiling-report-${identity}.pdf"`;
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) {
      return Response.json({ detail: "Mã profile không hợp lệ." }, { status: 400 });
    }
    const searchParams = new URL(request.url).searchParams;
    const reportId = searchParams.get("reportId");
    const source = await getExportSource(runId, reportId, requestedSections(searchParams.get("sections")), request);
    const pdf = await generateProfilingPdf(source);
    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(runId, reportId),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportSourceError) {
      return Response.json({ detail: error.message }, { status: error.status });
    }
    if (error instanceof PdfExportError) {
      return Response.json({ detail: error.message }, { status: error.status });
    }
    console.error("PDF export failed", error);
    return Response.json({ detail: "Không thể tạo PDF báo cáo. Vui lòng thử lại." }, { status: 500 });
  }
}
