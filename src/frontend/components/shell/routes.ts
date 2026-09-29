export type WorkspaceRoute =
  | { page: 'workspace' }
  | { page: 'chat'; conversationId?: string }
  | { page: 'runs'; runId?: string }
  | { page: 'reports'; reportId?: string }
  | { page: 'imports' }
  | { page: 'automations' };

export type WorkspaceSurface =
  | 'dashboard'
  | 'analysis'
  | 'reports'
  | 'schedules'
  | 'imports'
  | 'history';

export type ShellSection = 'workspace' | 'chat' | 'runs' | 'reports' | 'imports' | 'automations';

export type WorkspaceRouteMeta = {
  section: ShellSection;
  surface: WorkspaceSurface;
  title: string;
  eyebrow: string;
  description: string;
};

export const defaultWorkspaceRoute: WorkspaceRoute = { page: 'workspace' };

/**
 * Route selection is intentionally separate from the visible surface. A run
 * detail reuses the existing analysis surface, while the Runs navigation item
 * remains active and the browser URL stays shareable.
 */
export function workspaceRouteMeta(route: WorkspaceRoute): WorkspaceRouteMeta {
  switch (route.page) {
    case 'workspace':
      return {
        section: 'workspace',
        surface: 'dashboard',
        title: 'Tổng quan',
        eyebrow: 'VDaAGENT · ĐIỀU HÀNH',
        description: 'Theo dõi lượt phân tích, báo cáo, dữ liệu và lịch chạy của workspace.',
      };
    case 'chat':
      return {
        section: 'chat',
        surface: 'analysis',
        title: route.conversationId ? 'Cuộc trò chuyện' : 'Trợ lý AI',
        eyebrow: 'KHÔNG GIAN PHÂN TÍCH',
        description: 'Đặt câu hỏi và theo dõi quy trình phân tích cùng bằng chứng đã lưu.',
      };
    case 'runs':
      return route.runId
        ? {
            section: 'runs',
            surface: 'analysis',
            title: 'Chi tiết lượt chạy',
            eyebrow: 'LƯỢT PHÂN TÍCH',
            description: 'Theo dõi quy trình, artifact và bằng chứng của lượt chạy này.',
          }
        : {
            section: 'runs',
            surface: 'history',
            title: 'Lượt phân tích',
            eyebrow: 'LỊCH SỬ PHÂN TÍCH',
            description: 'Mở lại các lượt đã hoàn thành, đang chạy, đã hủy hoặc gặp lỗi.',
          };
    case 'reports':
      return {
        section: 'reports',
        surface: 'reports',
        title: 'Báo cáo',
        eyebrow: route.reportId ? 'CHI TIẾT BÁO CÁO' : 'THƯ VIỆN BÁO CÁO',
        description: 'Báo cáo đã duyệt vẫn liên kết với bằng chứng nguồn và bản xuất.',
      };
    case 'imports':
      return {
        section: 'imports',
        surface: 'imports',
        title: 'Nhập dữ liệu',
        eyebrow: 'NGUỒN DỮ LIỆU',
        description: 'Quản lý các snapshot CSV hiện có trong workspace này.',
      };
    case 'automations':
      return {
        section: 'automations',
        surface: 'schedules',
        title: 'Lịch tự động',
        eyebrow: 'TÁC VỤ THEO LỊCH',
        description: 'Tạo và theo dõi các quy trình báo cáo đã lên lịch.',
      };
  }
}

function withOrganization(path: string, orgId?: string): string {
  return orgId ? `${path}?org_id=${encodeURIComponent(orgId)}` : path;
}

export function workspaceRouteHref(route: WorkspaceRoute, orgId?: string): string {
  switch (route.page) {
    case 'workspace':
      return withOrganization('/workspace', orgId);
    case 'chat':
      return withOrganization(
        route.conversationId ? `/chat/${encodeURIComponent(route.conversationId)}` : '/chat',
        orgId,
      );
    case 'runs':
      return withOrganization(route.runId ? `/runs/${encodeURIComponent(route.runId)}` : '/runs', orgId);
    case 'reports':
      return withOrganization(
        route.reportId ? `/reports/${encodeURIComponent(route.reportId)}` : '/reports',
        orgId,
      );
    case 'imports':
      return withOrganization('/data/imports', orgId);
    case 'automations':
      return withOrganization('/automations', orgId);
  }
}
