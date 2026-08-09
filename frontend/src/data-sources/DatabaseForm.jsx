import React from "react";
import { TextField } from "../shared/components.jsx";

export function DatabaseForm({ values, setValues, connector }) {
  const hasBackendAdapter = Boolean(connector.backendType);
  return (
    <div className="form-grid">
      <TextField label="Connector" value={connector.title} onChange={() => {}} disabled />
      <TextField label="Engine" value={hasBackendAdapter ? values.type : "adapter required"} onChange={() => {}} disabled />
      <TextField label="Host" value={values.host} onChange={(value) => setValues({ ...values, host: value })} />
      <TextField label="Port" type="number" value={values.port} onChange={(value) => setValues({ ...values, port: value })} />
      <TextField label="Database" value={values.database} onChange={(value) => setValues({ ...values, database: value })} />
      <TextField label="Username" value={values.username} onChange={(value) => setValues({ ...values, username: value })} />
      <TextField label="Password" type="password" value={values.password} onChange={(value) => setValues({ ...values, password: value })} />
      <label>Auth type
        <select value={values.authType} onChange={(event) => setValues({ ...values, authType: event.target.value })}>
          <option value="username_password">Username/password</option>
          <option value="azure_ad_token">Azure AD token</option>
          <option value="aws_iam">AWS IAM</option>
          <option value="gcp_service_account">GCP service account</option>
          <option value="client_certificate">Client certificate</option>
        </select>
      </label>
      <TextField label="Driver" value={values.driver} onChange={(value) => setValues({ ...values, driver: value })} />
    </div>
  );
}
