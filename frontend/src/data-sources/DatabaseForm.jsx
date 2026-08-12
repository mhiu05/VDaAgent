import React from "react";

export function DatabaseForm({ values, setValues, connector }) {
  return (
    <div className="form-grid">
      <ReadOnlyField label="Connector" value={connector.title} />
      <ReadOnlyField label="Engine" value={values.type || connector.backendType || "adapter required"} />
      <FormField label="Host" value={values.host} onChange={(value) => setValues({ ...values, host: value })} />
      <FormField label="Port" type="number" value={values.port} onChange={(value) => setValues({ ...values, port: value })} />
      <FormField label="Database (optional)" value={values.database} onChange={(value) => setValues({ ...values, database: value })} />
      <FormField label="Username" value={values.username} onChange={(value) => setValues({ ...values, username: value })} />
      <FormField label="Password" type="password" value={values.password} onChange={(value) => setValues({ ...values, password: value })} />
      <label>Auth type
        <select value={values.authType} onChange={(event) => setValues({ ...values, authType: event.target.value })}>
          <option value="username_password">Username/password</option>
          <option value="azure_ad_token">Azure AD token</option>
          <option value="aws_iam">AWS IAM</option>
          <option value="gcp_service_account">GCP service account</option>
          <option value="client_certificate">Client certificate</option>
        </select>
      </label>
      <FormField label="Driver" value={values.driver} onChange={(value) => setValues({ ...values, driver: value })} />
    </div>
  );
}

function FormField({ label, type = "text", value, onChange }) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        autoComplete={type === "password" ? "new-password" : "off"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <label>
      {label}
      <input value={value} readOnly disabled />
    </label>
  );
}
