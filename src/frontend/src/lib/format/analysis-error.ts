/** Public recovery guidance for safe error codes; never display provider bodies. */
export function analysisErrorMessage(code: string | null | undefined): string | undefined {
  if (code === 'LLM_AUTHENTICATION_FAILED')
    return 'Dịch vụ AI từ chối thông tin xác thực. Quản trị viên cần kiểm tra cấu hình kết nối AI trước khi chạy lại. Các kết quả đã lưu vẫn có thể xem trong chi tiết phân tích.';
  return undefined;
}
