import re
import sys

def main():
    file_path = "src/api/authz_routes.py"
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Define replacements
    replacements = [
        (
            r'(@router\.post\("/reports", status_code=201\)\nasync def create_report\([\s\S]*?\)\s*->\s*dict\[str, Any\]:\n)(?:    try:[\s\S]*?)(?=\n\n@router\.post\("/reports/\{report_id\}/items")',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        return service.create_report(payload.model_dump(), context.workspace_id, context.user_id)
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
        (
            r'(@router\.patch\("/reports/\{report_id\}"\)\nasync def update_report\([\s\S]*?\)\s*->\s*dict\[str, Any\]:\n)(?:    try:[\s\S]*?)(?=\n\n@router\.delete\("/reports/\{report_id\}"\))',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        return service.update_report(report_id, payload.model_dump(), context.workspace_id, context.user_id)
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
        (
            r'(@router\.delete\("/reports/\{report_id\}"\)\nasync def delete_report\([\s\S]*?\)\s*->\s*dict\[str, Any\]:\n)(?:    try:[\s\S]*?)(?=\n\n@router\.post\("/reports/\{report_id\}/submit"\))',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        service.delete_report(report_id, context.workspace_id, context.user_id)
        return {"deleted": True, "report_id": report_id}
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
        (
            r'(@router\.post\("/reports/\{report_id\}/submit"\)\nasync def submit_report\([\s\S]*?\)\s*->\s*dict\[str, Any\]:\n)(?:    try:[\s\S]*?)(?=\n\n@router\.post\("/reports/\{report_id\}/review"\))',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        return service.submit_report(report_id, context.workspace_id, context.user_id)
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
        (
            r'(@router\.post\("/reports/\{report_id\}/review"\)\nasync def review_report\([\s\S]*?\)\s*->\s*dict\[str, Any\]:\n)(?:    try:[\s\S]*?)(?=\n\n@router\.post\("/reports/\{report_id\}/publish"\))',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        return service.review_report(report_id, payload.model_dump(), context.workspace_id, context.user_id)
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
        (
            r'(@router\.post\("/reports/\{report_id\}/publish"\)\nasync def publish_report\([\s\S]*?\)\s*->\s*dict\[str, Any\]:\n)(?:    try:[\s\S]*?)(?=\n\n@router\.post\("/reports/\{report_id\}/archive"\))',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        return service.publish_report(report_id, payload.model_dump(), context.workspace_id, context.user_id)
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
        (
            r'(@router\.post\("/reports/\{report_id\}/archive"\)\nasync def archive_report\([\s\S]*?\)\s*->\s*dict\[str, bool\]:\n)(?:    if not[\s\S]*?)(?=\n\n@router\.get\("/dashboard"\))',
            r'''\1    from src.services.report_service import ReportError, ReportService
    service = ReportService(get_repository(), get_audit())
    try:
        service.archive_report(report_id, context.workspace_id, context.user_id)
        return {"archived": True}
    except ReportError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e'''
        ),
    ]

    for pattern, replacement in replacements:
        content = re.sub(pattern, replacement, content)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)

    print("Success")

if __name__ == "__main__":
    main()
