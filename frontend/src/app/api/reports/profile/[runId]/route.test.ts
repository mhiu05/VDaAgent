import { beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock("@/lib/pdf-report", () => ({
  PdfExportError: class PdfExportError extends Error {
    status = 503;
  },
  generateProfilingPdf: renderer.generate,
}));

import { GET } from "./route";

describe("profiling PDF export route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    renderer.generate.mockReset();
  });

  it("uses the authorized report source and returns a downloadable PDF", async () => {
    renderer.generate.mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70]));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ profile: { run: { id: "run-1" } } }));

    const response = await GET(
      new Request("http://localhost/api/reports/profile/run-1?reportId=report-1", { headers: { Authorization: "Bearer token", "X-Workspace-Id": "workspace-1" } }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/reports/report-1/export-source?sections="),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token", "X-Workspace-Id": "workspace-1" }) }),
    );
  });

  it("preserves authorization failures from the report source", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 403 }));
    const response = await GET(new Request("http://localhost/api/reports/profile/run-1?reportId=report-1"), { params: Promise.resolve({ runId: "run-1" }) });
    expect(response.status).toBe(403);
    expect(renderer.generate).not.toHaveBeenCalled();
  });

  it("rejects an invalid profile identifier before fetching", async () => {
    const response = await GET(new Request("http://localhost/api/reports/profile/../etc"), { params: Promise.resolve({ runId: "../etc" }) });
    expect(response.status).toBe(400);
  });
});
