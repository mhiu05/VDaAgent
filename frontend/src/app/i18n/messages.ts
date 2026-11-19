import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { workspace } from "../integrations/workspace";
import { messages as chatMessages } from "../../features/chat/entry";
import { messages as authMessages } from "../../features/auth/entry";
import { messages as notificationMessages } from "../../features/notifications/entry";
import { messages as settingsMessages } from "../../features/settings/entry";
import { messages as agentsMessages } from "../../features/agents/entry";
import { messages as adminMessages } from "../../features/admin/entry";
export const coreMessages = {
  en: {
    brand: "Research, with context.",
    integrationPending: "Machine 2 · Pending integration",
    demo: "Demo data",
    themeToggle: "Switch theme",
    mock: "Mock frontend · no live model connected",
    dashboard: "Overview",
    reports: "Reports",
    chat: "Agent chat",
    groups: "Groups",
    notifications: "Notifications",
    settings: "Settings",
    users: "User management",
    agents: "Agent information",
    adminOverview: "System overview",
    signOut: "Sign out",
    profile: "Profile",
    menu: "Navigation",
    close: "Close",
    skip: "Skip to content",
    missingTitle: "Your workspace is taking shape",
    missing:
      "This feature belongs to Machine 2 and is awaiting integration. Core chat, notifications and settings are ready to explore.",
    openChat: "Open agent chat",
    home: "Go to home",
    unauthorized: "You do not have access to this page",
    denied:
      "USER and ADMIN have independent workspaces. Return to your role’s home to continue.",
    notFound: "Page not found",
    notFoundText: "This address does not match a workspace page.",
    loading: "Loading…",
    retry: "Try again",
    expired: "Your demo session expired. Sign in to continue.",
    credentials: "Email or password is incorrect.",
    unavailable: "The demo service is unavailable. Try again.",
    saveError: "Changes could not be saved. Your draft is preserved.",
    invalid: "Please check the entered values.",
    storage:
      "Storage is unavailable or damaged. Changes may only be kept in this session.",
    domainUnavailable:
      "The data domain is misconfigured, contact the administrator.",
    save: "Save changes",
    cancel: "Cancel",
    reset: "Reset",
    saved: "Changes saved",
    error: "Something went wrong",
    back: "Back",
    all: "All",
    unread: "Unread",
    search: "Search",
    empty: "Nothing here yet",
    confirm: "Confirm",
    discard: "Discard changes",
    dirty: "You have unsaved changes. Discard them and leave?",
    copy: "Copy",
    copied: "Copied",
    copyError: "Copy failed. Select and copy the text manually.",
    source: "Demo source",
    restricted: "This source is restricted.",
    missingSource: "This source is no longer available.",
    view: "View",
    system: "System",
    light: "Light",
    dark: "Dark",
    language: "Language",
    offline:
      "You are offline. Your draft is preserved; messages are not queued.",
    pending: "Pending",
    complete: "Complete",
    unknown: "Not published",
    demoConfig: "Demo configuration",
    unsupported: "Unavailable in this demo",
    targetMissing:
      "This target is missing, restricted, or awaiting workspace integration.",
  },
  vi: {
    integrationPending: "Máy 2 · Đang chờ tích hợp",
    brand: "Nghiên cứu, có ngữ cảnh.",
    demo: "Dữ liệu minh họa",
    themeToggle: "Đổi giao diện",
    mock: "Frontend minh họa · chưa kết nối mô hình thật",
    dashboard: "Trang chủ",
    reports: "Kho báo cáo",
    chat: "Trợ lý agent",
    groups: "Nhóm",
    notifications: "Thông báo",
    settings: "Cài đặt",
    users: "Quản lý người dùng",
    agents: "Thông tin Agents",
    adminOverview: "Tổng quan hệ thống",
    signOut: "Đăng xuất",
    profile: "Hồ sơ",
    menu: "Điều hướng",
    close: "Đóng",
    skip: "Đến nội dung chính",
    missingTitle: "Không gian làm việc đang hình thành",
    missing:
      "Tính năng này do Máy 2 phụ trách và đang chờ tích hợp. Bạn có thể trải nghiệm Chat, Thông báo và Cài đặt.",
    openChat: "Mở trò chuyện Agent",
    home: "Về trang chủ",
    unauthorized: "Bạn không có quyền truy cập trang này",
    denied:
      "USER và ADMIN có không gian độc lập. Về trang chủ theo vai trò để tiếp tục.",
    notFound: "Không tìm thấy trang",
    notFoundText:
      "Địa chỉ này không khớp với trang nào trong không gian làm việc.",
    loading: "Đang tải…",
    retry: "Thử lại",
    expired: "Phiên minh họa đã hết hạn. Đăng nhập để tiếp tục.",
    credentials: "Email hoặc mật khẩu không chính xác.",
    unavailable: "Dịch vụ minh họa chưa khả dụng. Vui lòng thử lại.",
    saveError: "Chưa lưu được thay đổi. Bản nháp vẫn được giữ.",
    invalid: "Vui lòng kiểm tra các giá trị đã nhập.",
    storage:
      "Bộ nhớ không khả dụng hoặc bị hỏng. Thay đổi có thể chỉ được giữ trong phiên này.",
    domainUnavailable:
      "Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên",
    save: "Lưu thay đổi",
    cancel: "Hủy",
    reset: "Đặt lại",
    saved: "Đã lưu thay đổi",
    error: "Đã xảy ra lỗi",
    back: "Quay lại",
    all: "Tất cả",
    unread: "Chưa đọc",
    search: "Tìm kiếm",
    empty: "Chưa có nội dung",
    confirm: "Xác nhận",
    discard: "Bỏ thay đổi",
    dirty: "Bạn có thay đổi chưa lưu. Bỏ thay đổi và rời trang?",
    copy: "Sao chép",
    copied: "Đã sao chép",
    copyError: "Chưa sao chép được. Hãy chọn và sao chép văn bản thủ công.",
    source: "Nguồn minh họa",
    restricted: "Nguồn này bị giới hạn truy cập.",
    missingSource: "Nguồn này không còn khả dụng.",
    view: "Xem",
    system: "Hệ thống",
    light: "Sáng",
    dark: "Tối",
    language: "Ngôn ngữ",
    offline:
      "Bạn đang ngoại tuyến. Bản nháp được giữ; tin nhắn không được tự gửi lại.",
    pending: "Đang chờ",
    complete: "Hoàn tất",
    unknown: "Chưa công bố",
    demoConfig: "Cấu hình minh họa",
    unsupported: "Chưa khả dụng trong bản minh họa",
    targetMissing:
      "Đích đến không tồn tại, bị giới hạn hoặc đang chờ tích hợp workspace.",
  },
};
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: "vi",
  fallbackLng: "en",
  ns: ["app"],
  defaultNS: "app",
  interpolation: { escapeValue: false },
  resources: { vi: { app: coreMessages.vi }, en: { app: coreMessages.en } },
  initAsync: false,
});
for (const [namespace, messages] of Object.entries(workspace.messages))
  if (messages)
    for (const locale of ["vi", "en"] as const)
      i18n.addResourceBundle(locale, namespace, messages[locale]);
for (const locale of ["vi", "en"] as const)
  i18n.addResourceBundle(locale, "chat", chatMessages[locale]);

for (const locale of ["vi", "en"] as const) {
  i18n.addResourceBundle(locale, "auth", authMessages[locale]);
  i18n.addResourceBundle(locale, "notifications", notificationMessages[locale]);
  i18n.addResourceBundle(locale, "settings", settingsMessages[locale]);
  i18n.addResourceBundle(locale, "agents", agentsMessages[locale]);
  i18n.addResourceBundle(locale, "admin", adminMessages[locale]);
}
