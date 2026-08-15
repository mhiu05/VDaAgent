export const DEFAULT_API_BASE = "http://localhost:8000/api/v1";

export async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${error?.message || "Network request failed"} (${url})`);
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    const message = data?.detail || data?.message || `Request failed with ${response.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

export function fileForm(files, fieldName = "file") {
  const form = new FormData();
  if (Array.isArray(files)) {
    files.forEach((file) => form.append(fieldName, file));
  } else if (files) {
    form.append(fieldName, files);
  }
  return form;
}

export function databaseConnectionFromForm(values) {
  return {
    type: values.type,
    host: values.host,
    database: values.database || "",
    username: values.username || null,
    password: values.password || null,
    port: Number(values.port || (values.type === "postgresql" ? 5432 : 1433)),
    driver: values.driver || null,
    auth_type: values.authType,
    encrypt: true,
    trust_server_certificate: false,
  };
}
